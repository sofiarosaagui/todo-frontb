import { api } from "../../api";

// Importa funciones para manejar la base de datos local y la cola de operaciones pendientes:
// - getOutbox: obtiene todas las operaciones pendientes de sincronizar
// - clearOutbox: limpia toda la cola de operaciones pendientes
// - queue: agrega una operación a la cola offline
// - setMapping: guarda la relación entre un ID local (clienteId) y el ID real del servidor (serverId)
// - getMapping: obtiene el ID del servidor a partir de un ID local
// - removeTaskLocal: elimina una tarea del almacenamiento local
// - promoteLocalToServer: reemplaza el ID local de una tarea por el ID real del servidor
import {
  getOutbox, clearOutbox, queue, setMapping, getMapping,
  removeTaskLocal, promoteLocalToServer
} from "./db";

// Importa la función para mostrar notificaciones visuales al usuario
import { notify } from "./notificacion-bus";

// Flag global del módulo que indica si ya hay una sincronización en curso
// Al ser una variable del módulo (fuera del componente), sobrevive re-renders y al doble montaje de React StrictMode
let isSyncing = false;

// Función principal que sincroniza todas las operaciones pendientes con el servidor
export async function syncNow() {
  if (!navigator.onLine) return;  // Si no hay internet, no hace nada
  if (isSyncing) return;          // Si ya hay un sync en curso, ignora esta llamada para evitar duplicados
  isSyncing = true;               // Marca que ya hay una sincronización activa

  try {
    // Obtiene la lista de operaciones pendientes y las ordena por timestamp (las más antiguas primero)
    const ops = (await getOutbox() as any[]).sort((a,b)=>a.ts-b.ts);
    if (!ops.length) return; // Si no hay nada pendiente, termina sin hacer nada

    const failedOps: any[] = []; // Acumulador de operaciones que fallaron para re-encolarlas después

    // Prepara las operaciones de creación y actualización para enviarlas en bloque (bulksync)
    const toSync: any[] = [];
    for (const op of ops) {
      if (op.op === "create") {
        // Si es una creación, agrega los datos de la tarea al lote
        toSync.push({
          clienteId: op.clienteId,            // ID local temporal
          title: op.data.title,
          description: op.data.description ?? "",
          status: op.data.status ?? "Pendiente",
        });
      } else if (op.op === "update") {
        const cid = op.clienteId;
        if (cid) {
          // Si la actualización tiene clienteId (ID local), también va al bulksync
          toSync.push({
            clienteId: cid,
            title: op.data.title,
            description: op.data.description,
            status: op.data.status,
          });
        } else if (op.serverId) {
          // Si ya tiene ID del servidor, hace la actualización directamente (PUT individual)
          try {
            await api.put(`/tasks/${op.serverId}`, op.data);
            notify("success", `Tarea actualizada correctamente.`);
          } catch {
            // Si falla, guarda la operación para reintentarla después
            notify("error", `No se pudo actualizar una tarea en el servidor.`);
            failedOps.push(op);
          }
        }
      }
    }

    // Si hay operaciones de creación/actualización con IDs locales, las envía todas juntas al servidor
    if (toSync.length) {
      try {
        // Envía el lote al endpoint de sincronización masiva
        const { data } = await api.post("/tasks/bulksync", { tasks: toSync });

        // Por cada tarea sincronizada, guarda la relación clienteId → serverId y actualiza el ID en local
        for (const map of data?.mapping || []) {
          await setMapping(map.clienteId, map.serverId);          // Guarda el mapeo de IDs
          await promoteLocalToServer(map.clienteId, map.serverId); // Actualiza el ID local por el real del servidor
        }

        const synced = (data?.mapping || []).length; // Cantidad de tareas sincronizadas correctamente
        if (synced > 0) {
          // Notifica cuántas tareas se sincronizaron (con plural correcto)
          notify("success", `${synced} tarea${synced !== 1 ? "s" : ""} sincronizada${synced !== 1 ? "s" : ""} correctamente.`);
        }

        const failed = toSync.length - synced; // Tareas que se enviaron pero no regresaron en el mapping (fallaron)
        if (failed > 0) {
          notify("error", `${failed} tarea${failed !== 1 ? "s" : ""} no pudieron sincronizarse. Se reintentará pronto.`);

          // Identifica cuáles operaciones fallaron comparando los clienteIds que sí regresaron del servidor
          const syncedIds = new Set((data?.mapping || []).map((m: any) => m.clienteId));
          const failedCreates = ops.filter(
            (op) => (op.op === "create" || (op.op === "update" && op.clienteId))
                    && !syncedIds.has(op.clienteId) // Solo las que NO fueron confirmadas por el servidor
          );
          failedOps.push(...failedCreates); // Las agrega al acumulador de fallidas
        }
      } catch {
        // Si el bulksync falla por completo (error de red u otro), re-encola todas las operaciones del lote
        notify("error", `Error al sincronizar ${toSync.length} tarea${toSync.length !== 1 ? "s" : ""} pendiente${toSync.length !== 1 ? "s" : ""}. Se reintentará pronto.`);
        failedOps.push(...ops.filter((op) => op.op === "create" || (op.op === "update" && op.clienteId)));
        return; // Termina aquí para no intentar eliminar tareas con el estado inconsistente
      }
    }

    // Procesa las operaciones de eliminación pendientes
    for (const op of ops) {
      if (op.op !== "delete") continue; // Solo procesa las de tipo "delete"

      // Obtiene el ID del servidor: lo toma directo de la operación o lo busca en el mapeo si solo tiene clienteId
      const serverId = op.serverId ?? (op.clienteId ? await getMapping(op.clienteId) : undefined);
      if (!serverId) continue; // Si no hay ID del servidor, no puede eliminar (la salta)

      try {
        await api.delete(`/tasks/${serverId}`);                    // Elimina la tarea en el servidor
        await removeTaskLocal(op.clienteId || serverId);           // Elimina la tarea del almacenamiento local
        notify("info", `Tarea eliminada del servidor.`);
      } catch {
        // Si falla la eliminación, re-encola para reintentarlo después
        notify("error", `No se pudo eliminar una tarea del servidor. Se reintentará pronto.`);
        failedOps.push(op);
      }
    }

    // Limpia toda la cola de operaciones pendientes
    await clearOutbox();

    // Vuelve a encolar solo las operaciones que fallaron para reintentarlas en el próximo sync
    for (const op of failedOps) await queue(op);

  } finally {
    isSyncing = false; // Libera el flag siempre, incluso si hubo un return anticipado dentro del try
  }
}

// Configura la sincronización automática al recuperar conexión y cada 30 segundos si hay pendientes
export function setupOnlineSync(onSyncDone?: () => void) {

  // Función que ejecuta el sync y avisa al Dashboard cuando termina
  const handler = async () => {
    await syncNow();    // Espera a que termine toda la sincronización
    onSyncDone?.();     // Solo entonces notifica al componente que llamó a esta función
  };

  // Intervalo que revisa cada 30 segundos si hay operaciones pendientes y hay internet
  const interval = setInterval(async () => {
    if (!navigator.onLine) return; // Si no hay internet, no hace nada
    const ops = await import("./db").then((m) => m.getOutbox()); // Obtiene la cola de pendientes
    if (ops.length) await handler(); // Si hay pendientes y hay conexión, intenta sincronizar
  }, 30_000); // Se ejecuta cada 30 segundos

  // Escucha el evento del navegador cuando se recupera la conexión a internet
  window.addEventListener("online", handler);

  // Retorna una función de limpieza que cancela el listener y el intervalo al desmontar
  return () => {
    window.removeEventListener("online", handler); // Deja de escuchar reconexiones
    clearInterval(interval);                       // Cancela el intervalo de 30 segundos
  };
}