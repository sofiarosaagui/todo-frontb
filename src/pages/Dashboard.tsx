// src/components/Dashboard.tsx
import { useEffect, useMemo, useState } from "react";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  type OutboxOp,
} from "../offline/db";
import { syncNow, setupOnlineSync } from "../offline/sync";
import { api, setAuth } from "../../api";
import { notify } from "../offline/notificacion-bus";
import Notifications from "../notificacion";

type Status = "Pendiente" | "En Progreso" | "Completada";

type Task = {
  _id: string;
  title: string;
  description?: string;
  status: Status;
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
  pending?: boolean;
};

const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);

function normalizeTask(x: any): Task {
  return {
    _id: String(x?._id ?? x?.id),
    title: String(x?.title ?? "(sin título)"),
    description: x?.description ?? "",
    status:
      x?.status === "Completada" ||
      x?.status === "En Progreso" ||
      x?.status === "Pendiente"
        ? x.status
        : "Pendiente",
    clienteId: x?.clienteId,
    createdAt: x?.createdAt,
    deleted: !!x?.deleted,
    pending: !!x?.pending,
  };
}

export default function Dashboard() {
  const [loading, setLoading]                 = useState(true);
  const [tasks, setTasks]                     = useState<Task[]>([]);
  const [title, setTitle]                     = useState("");
  const [description, setDescription]         = useState("");
  const [search, setSearch]                   = useState("");
  const [filter, setFilter]                   = useState<"all" | "active" | "completed">("all");
  const [editingId, setEditingId]             = useState<string | null>(null);
  const [editingTitle, setEditingTitle]       = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [online, setOnline]                   = useState<boolean>(navigator.onLine);

  useEffect(() => {
    setAuth(localStorage.getItem("token"));

    const unsubscribe = setupOnlineSync(async() => {
      await loadFromServer(); //espera a que la sincronizacion principal termine y no generar mas de una llamada a la api al mismo tiempo
    });

    const on = async () => {
      setOnline(true);
      notify("info", "Conexión restaurada. Sincronizando tareas pendientes…");
      // await syncNow();
      // await loadFromServer();
    };
    const off = () => {
      setOnline(false);
      notify("warning", "Sin conexión. Las acciones se guardarán localmente.");
    };

    window.addEventListener("online",  on);
    window.addEventListener("offline", off);

    (async () => {
      const local = await getAllTasksLocal();
      if (local?.length) setTasks(local.map(normalizeTask));
      await loadFromServer();
      await syncNow();
      await loadFromServer();
    })();

    return () => {
      unsubscribe?.();
      window.removeEventListener("online",  on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // ─── Carga desde servidor ─────────────────────────────────────────────────
  async function loadFromServer() {
    try {
      const { data } = await api.get("/tasks");
      const raw  = Array.isArray(data?.items) ? data.items : [];
      const list = raw.map(normalizeTask);
      setTasks(list);
      await cacheTasks(list);
    } catch {
      // quedamos con lo local sin avisar (ya lo sabe el usuario)
    } finally {
      setLoading(false);
    }
  }

  // ─── Crear ────────────────────────────────────────────────────────────────
  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const d = description.trim();
    if (!t) return;

    const clienteId = crypto.randomUUID();
    const localTask = normalizeTask({
      _id: clienteId,
      title: t,
      description: d,
      status: "Pendiente" as Status,
      pending: !navigator.onLine,
    });

    setTasks((prev) => [localTask, ...prev]);
    await putTaskLocal(localTask);
    setTitle("");
    setDescription("");

    if (!navigator.onLine) {
      const op: OutboxOp = {
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
      notify("warning", `"${t}" guardada offline. Se sincronizará cuando vuelva el internet.`);
      return;
    }

    try {
      const { data } = await api.post("/tasks", { title: t, description: d });
      const created  = normalizeTask(data?.task ?? data);
      setTasks((prev) => prev.map((x) => (x._id === clienteId ? created : x)));
      await putTaskLocal(created);
      notify("success", `Tarea "${t}" creada correctamente.`);
    } catch {
      const op: OutboxOp = {
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
      notify("warning", `Sin conexión con el servidor. "${t}" se sincronizará después.`);
    }
  }

  // ─── Edición ──────────────────────────────────────────────────────────────
  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDescription(task.description ?? "");
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    const newDesc  = editingDescription.trim();
    if (!newTitle) return;

    const before  = tasks.find((t) => t._id === taskId);
    const patched = { ...before, title: newTitle, description: newDesc } as Task;

    setTasks((prev) => prev.map((t) => (t._id === taskId ? patched : t)));
    await putTaskLocal(patched);
    setEditingId(null);

    if (!navigator.onLine) {
      await queue({
        id: "upd-" + taskId,
        op: "update",
        clienteId: isLocalId(taskId) ? taskId : undefined,
        serverId:  isLocalId(taskId) ? undefined : taskId,
        data: { title: newTitle, description: newDesc },
        ts: Date.now(),
      } as OutboxOp);
      notify("warning", `Cambios en "${newTitle}" guardados localmente. Pendiente de sincronización.`);
      return;
    }

    try {
      await api.put(`/tasks/${taskId}`, { title: newTitle, description: newDesc });
      notify("success", `Tarea "${newTitle}" actualizada.`);
    } catch {
      await queue({
        id: "upd-" + taskId,
        op: "update",
        serverId: taskId,
        data: { title: newTitle, description: newDesc },
        ts: Date.now(),
      } as OutboxOp);
      notify("warning", `No se pudo actualizar ahora. Los cambios se sincronizarán después.`);
    }
  }

  // ─── Cambio de estado ─────────────────────────────────────────────────────
  async function handleStatusChange(task: Task, newStatus: Status) {
    const updated = { ...task, status: newStatus };
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    await putTaskLocal(updated);

    if (!navigator.onLine) {
      await queue({
        id: "upd-" + task._id,
        op: "update",
        serverId:  isLocalId(task._id) ? undefined : task._id,
        clienteId: isLocalId(task._id) ? task._id : undefined,
        data: { status: newStatus },
        ts: Date.now(),
      });
      notify("warning", `"${task.title}" marcada como "${newStatus}" offline.`);
      return;
    }

    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus });
      notify("success", `"${task.title}" → ${newStatus}.`);
    } catch {
      await queue({
        id: "upd-" + task._id,
        op: "update",
        serverId: task._id,
        data: { status: newStatus },
        ts: Date.now(),
      });
      notify("warning", `Cambio de estado guardado localmente. Se sincronizará después.`);
    }
  }

  // ─── Eliminar ─────────────────────────────────────────────────────────────
  async function removeTask(taskId: string) {
    const backup  = tasks;
    const removed = tasks.find((t) => t._id === taskId);
    setTasks((prev) => prev.filter((t) => t._id !== taskId));
    await removeTaskLocal(taskId);

    if (!navigator.onLine) {
      await queue({
        id: "del-" + taskId,
        op: "delete",
        serverId:  isLocalId(taskId) ? undefined : taskId,
        clienteId: isLocalId(taskId) ? taskId : undefined,
        ts: Date.now(),
      });
      notify("warning", `"${removed?.title}" eliminada localmente. Se eliminará del servidor al volver el internet.`);
      return;
    }

    try {
      await api.delete(`/tasks/${taskId}`);
      notify("info", `"${removed?.title}" eliminada.`);
    } catch {
      // rollback + encola
      setTasks(backup);
      for (const t of backup) await putTaskLocal(t);
      await queue({
        id: "del-" + taskId,
        op: "delete",
        serverId:  taskId,
        clienteId: isLocalId(taskId) ? taskId : undefined,
        ts: Date.now(),
      });
      notify("error", `No se pudo eliminar "${removed?.title}". Se reintentará cuando haya conexión.`);
    }
  }

  // ─── Logout ───────────────────────────────────────────────────────────────
  function logout() {
    localStorage.removeItem("token");
    setAuth(null);
    window.location.href = "/";
  }

  // ─── Filtros ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = tasks;
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.title || "").toLowerCase().includes(s) ||
          (t.description || "").toLowerCase().includes(s)
      );
    }
    if (filter === "active")    list = list.filter((t) => t.status !== "Completada");
    if (filter === "completed") list = list.filter((t) => t.status === "Completada");
    return list;
  }, [tasks, search, filter]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done  = tasks.filter((t) => t.status === "Completada").length;
    return { total, done, pending: total - done };
  }, [tasks]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="wrap">
      {/* Toast - notifacione container — siempre montado */}
      <Notifications />

      <header className="topbar">
        <h1>To-Do PWA</h1>
        <div className="spacer" />
        <div className="stats">
          <span>Total: {stats.total}</span>
          <span>Hechas: {stats.done}</span>
          <span>Pendientes: {stats.pending}</span>
          <span
            className="badge"
            style={{ marginLeft: 8, background: online ? "#1f6feb" : "#b45309" }}
          >
            {online ? "Online" : "Offline"}
          </span>
        </div>
        <button className="btn danger" onClick={logout}>Salir</button>
      </header>

      <main>
        {/* ── Crear ── */}
        <form className="add add-grid" onSubmit={addTask}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título de la tarea…"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción (opcional)…"
            rows={2}
          />
          <button className="btn">Agregar</button>
        </form>

        {/* ── Toolbar ── */}
        <div className="toolbar">
          <input
            className="search"
            placeholder="Buscar por título o descripción…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="filters">
            {(["all", "active", "completed"] as const).map((f) => (
              <button
                key={f}
                className={filter === f ? "chip active" : "chip"}
                onClick={() => setFilter(f)}
                type="button"
              >
                {{ all: "Todas", active: "Activas", completed: "Hechas" }[f]}
              </button>
            ))}
          </div>
        </div>

        {/* ── Lista ── */}
        {loading ? (
          <p>Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className="empty">Sin tareas</p>
        ) : (
          <ul className="list">
            {filtered.map((t) => (
              <li
                key={t._id}
                className={t.status === "Completada" ? "item done" : "item"}
              >
                <select
                  value={t.status}
                  onChange={(e) => handleStatusChange(t, e.target.value as Status)}
                  className="status-select"
                  title="Estado"
                >
                  <option value="Pendiente">Pendiente</option>
                  <option value="En Progreso">En Progreso</option>
                  <option value="Completada">Completada</option>
                </select>

                <div className="content">
                  {editingId === t._id ? (
                    <>
                      <input
                        className="edit"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        placeholder="Título"
                        autoFocus
                      />
                      <textarea
                        className="edit"
                        value={editingDescription}
                        onChange={(e) => setEditingDescription(e.target.value)}
                        placeholder="Descripción"
                        rows={2}
                      />
                    </>
                  ) : (
                    <>
                      <span className="title" onDoubleClick={() => startEdit(t)}>
                        {t.title}
                      </span>
                      {t.description && <p className="desc">{t.description}</p>}
                      {(t.pending || isLocalId(t._id)) && (
                        <span
                          className="badge"
                          title="Aún no sincronizada"
                          style={{ background: "#b45309", width: "fit-content" }}
                        >
                          Falta sincronizar
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div className="actions">
                  {editingId === t._id ? (
                    <button className="btn" onClick={() => saveEdit(t._id)}>
                      Guardar
                    </button>
                  ) : (
                    <button className="icon" title="Editar" onClick={() => startEdit(t)}>
                      ✏️
                    </button>
                  )}
                  <button
                    className="icon danger"
                    title="Eliminar"
                    onClick={() => removeTask(t._id)}
                  >
                    🗑️
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}