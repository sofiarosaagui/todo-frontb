import { api } from "../../api";
import {
  getOutbox, clearOutbox, queue, setMapping, getMapping,
  removeTaskLocal, promoteLocalToServer
} from "./db";
import { notify } from "./notificacion-bus";

let isSyncing = false; // flag de módulo — sobrevive re-renders y doble montaje de StrictMode

export async function syncNow() {
  if (!navigator.onLine) return;
  if (isSyncing) return; // ya hay un sync en curso, ignorar llamada duplicada
  isSyncing = true;

  try {
    const ops = (await getOutbox() as any[]).sort((a,b)=>a.ts-b.ts);
    if (!ops.length) return;

    const failedOps: any[] = [];

    // Crea/Actualiza por bulksync (para items con clienteId)
    const toSync: any[] = [];
    for (const op of ops) {
      if (op.op === "create") {
        toSync.push({
          clienteId: op.clienteId,
          title: op.data.title,
          description: op.data.description ?? "",
          status: op.data.status ?? "Pendiente",
        });
      } else if (op.op === "update") {
        const cid = op.clienteId;
        if (cid) {
          toSync.push({
            clienteId: cid,
            title: op.data.title,
            description: op.data.description,
            status: op.data.status,
          });
        } else if (op.serverId) {
          try {
            await api.put(`/tasks/${op.serverId}`, op.data);
            notify("success", `Tarea actualizada correctamente.`);
          } catch {
            notify("error", `No se pudo actualizar una tarea en el servidor.`);
            failedOps.push(op);
          }
        }
      }
    }

    // Ejecuta bulksync y PROMUEVE ids locales
    if (toSync.length) {
      try {
        const { data } = await api.post("/tasks/bulksync", { tasks: toSync });
        for (const map of data?.mapping || []) {
          await setMapping(map.clienteId, map.serverId);
          await promoteLocalToServer(map.clienteId, map.serverId);
        }
        const synced = (data?.mapping || []).length;
        if (synced > 0) {
          notify("success", `${synced} tarea${synced !== 1 ? "s" : ""} sincronizada${synced !== 1 ? "s" : ""} correctamente.`);
        }
        const failed = toSync.length - synced;
        if (failed > 0) {
          notify("error", `${failed} tarea${failed !== 1 ? "s" : ""} no pudieron sincronizarse. Se reintentará pronto.`);
          const syncedIds = new Set((data?.mapping || []).map((m: any) => m.clienteId));
          const failedCreates = ops.filter(
            (op) => (op.op === "create" || (op.op === "update" && op.clienteId))
                    && !syncedIds.has(op.clienteId)
          );
          failedOps.push(...failedCreates);
        }
      } catch {
        notify("error", `Error al sincronizar ${toSync.length} tarea${toSync.length !== 1 ? "s" : ""} pendiente${toSync.length !== 1 ? "s" : ""}. Se reintentará pronto.`);
        failedOps.push(...ops.filter((op) => op.op === "create" || (op.op === "update" && op.clienteId)));
        return; // no continuar a deletes con estado inconsistente
      }
    }

    // Borra pendientes (necesita serverId)
    for (const op of ops) {
      if (op.op !== "delete") continue;
      const serverId = op.serverId ?? (op.clienteId ? await getMapping(op.clienteId) : undefined);
      if (!serverId) continue;
      try {
        await api.delete(`/tasks/${serverId}`);
        await removeTaskLocal(op.clienteId || serverId);
        notify("info", `Tarea eliminada del servidor.`);
      } catch {
        notify("error", `No se pudo eliminar una tarea del servidor. Se reintentará pronto.`);
        failedOps.push(op);
      }
    }

    // Limpiar outbox y re-encolar solo los que fallaron
    await clearOutbox();
    for (const op of failedOps) await queue(op);

  } finally {
    isSyncing = false; // siempre liberar el flag, incluso si hubo return anticipado
  }
}

// Suscripción a online/offline - reintento cada 30 s si hay ops pendientes
export function setupOnlineSync(onSyncDone?: () => void) {
  const handler = async () => {
    await syncNow(); // espera a que termine todo el sync
    onSyncDone?.(); // solo entonces avisa al Dashboard
  };

  const interval = setInterval(async () => {
    if (!navigator.onLine) return; //no hace nada si no hay conexión
    const ops = await import("./db").then((m) => m.getOutbox());
    if (ops.length) await handler(); // reintentar sync cada 30s si hay pendientes y estamos online
  }, 30_000); // 30 segundos cada reintento

  window.addEventListener("online", handler);
  return () => {
    window.removeEventListener("online", handler);
    clearInterval(interval); //limpia el intervalo
  };
}