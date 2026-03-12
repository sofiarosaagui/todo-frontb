
import { api } from "../../api";

import {
  getOutbox, clearOutbox, queue, setMapping, getMapping,
  removeTaskLocal, promoteLocalToServer
} from "./db";


import { notify } from "./notificacion-bus";


let isSyncing = false;


export async function syncNow() {
  if (!navigator.onLine) return;  
  if (isSyncing) return;         
  isSyncing = true;               

  try {
    
    const ops = (await getOutbox() as any[]).sort((a,b)=>a.ts-b.ts);
    if (!ops.length) return; 

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

    await clearOutbox();

    
    for (const op of failedOps) await queue(op);

  } finally {
    isSyncing = false; 
  }
}


export function setupOnlineSync(onSyncDone?: () => void) {

  
  const handler = async () => {
    await syncNow();    
    onSyncDone?.();     
  };


  const interval = setInterval(async () => {
    if (!navigator.onLine) return; 
    const ops = await import("./db").then((m) => m.getOutbox()); 
    if (ops.length) await handler(); 
  }, 30_000); 

  
  window.addEventListener("online", handler);

  
  return () => {
    window.removeEventListener("online", handler); 
    clearInterval(interval);                       
  };
}