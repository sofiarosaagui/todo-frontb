// src/components/Dashboard.tsx

// Importa hooks de React:
// - useEffect: para ejecutar código al montar/desmontar el componente
// - useMemo: para calcular valores derivados sin recalcular en cada render
// - useState: para guardar y actualizar datos en el componente
import { useEffect, useMemo, useState } from "react";

// Importa funciones para manejar tareas en la base de datos local (IndexedDB/offline):
// - cacheTasks: guarda una lista de tareas localmente
// - getAllTasksLocal: obtiene todas las tareas guardadas en local
// - putTaskLocal: guarda o actualiza una tarea en local
// - removeTaskLocal: elimina una tarea del almacenamiento local
// - queue: agrega una operación pendiente a la cola offline (outbox)
// - OutboxOp: tipo de dato que describe una operación pendiente
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  type OutboxOp,
} from "../offline/db";

// Importa funciones de sincronización:
// - syncNow: sincroniza inmediatamente las operaciones pendientes con el servidor
// - setupOnlineSync: configura la sincronización automática cuando se recupera internet
import { syncNow, setupOnlineSync } from "../offline/sync";

// Importa el cliente HTTP para hacer peticiones al servidor, y setAuth para configurar el token de autenticación
import { api, setAuth } from "../../api";

// Importa la función para mostrar notificaciones visuales al usuario
import { notify } from "../offline/notificacion-bus";

// Importa el componente visual que renderiza las notificaciones en pantalla
import Notifications from "../notificacion";

// Define los valores posibles para el estado de una tarea
type Status = "Pendiente" | "En Progreso" | "Completada";

// Define la estructura de datos de una tarea
type Task = {
  _id: string;          // Identificador único de la tarea
  title: string;        // Título de la tarea
  description?: string; // Descripción opcional
  status: Status;       // Estado actual de la tarea
  clienteId?: string;   // ID temporal generado en el cliente antes de sincronizar
  createdAt?: string;   // Fecha de creación
  deleted?: boolean;    // Indica si la tarea fue eliminada
  pending?: boolean;    // Indica si la tarea aún no se ha sincronizado con el servidor
};

// Función que detecta si un ID es local (temporal) o si ya vino del servidor (MongoDB usa IDs de 24 caracteres hexadecimales)
const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);

// Función que convierte cualquier objeto recibido en una Task con estructura segura y valores por defecto
function normalizeTask(x: any): Task {
  return {
    _id: String(x?._id ?? x?.id),                          // Acepta tanto _id como id
    title: String(x?.title ?? "(sin título)"),              // Si no tiene título, pone un valor por defecto
    description: x?.description ?? "",                      // Si no hay descripción, cadena vacía
    status:
      x?.status === "Completada" ||
      x?.status === "En Progreso" ||
      x?.status === "Pendiente"
        ? x.status
        : "Pendiente",                                      // Si el status no es válido, lo pone como "Pendiente"
    clienteId: x?.clienteId,                               // ID del cliente si existe
    createdAt: x?.createdAt,                               // Fecha de creación si existe
    deleted: !!x?.deleted,                                 // Convierte a booleano
    pending: !!x?.pending,                                 // Convierte a booleano
  };
}

// Componente principal del Dashboard
export default function Dashboard() {
  const [loading, setLoading]                           = useState(true);         // Controla si se está cargando la lista
  const [tasks, setTasks]                               = useState<Task[]>([]);   // Lista de todas las tareas
  const [title, setTitle]                               = useState("");            // Valor del input de título al crear tarea
  const [description, setDescription]                   = useState("");            // Valor del textarea de descripción al crear tarea
  const [search, setSearch]                             = useState("");            // Texto escrito en el buscador
  const [filter, setFilter]                             = useState<"all" | "active" | "completed">("all"); // Filtro activo
  const [editingId, setEditingId]                       = useState<string | null>(null);  // ID de la tarea que se está editando
  const [editingTitle, setEditingTitle]                 = useState("");            // Título temporal mientras se edita
  const [editingDescription, setEditingDescription]     = useState("");            // Descripción temporal mientras se edita
  const [online, setOnline]                             = useState<boolean>(navigator.onLine); // Estado de conexión a internet

  // Se ejecuta una sola vez al montar el componente
  useEffect(() => {
    setAuth(localStorage.getItem("token")); // Configura el token JWT para las peticiones a la API

    // Configura la sincronización automática cuando se recupera internet; al reconectarse, carga las tareas del servidor
    const unsubscribe = setupOnlineSync(async() => {
      await loadFromServer();
    });

    // Cuando se recupera internet: actualiza el estado y notifica al usuario
    const on = async () => {
      setOnline(true);
      notify("info", "Conexión restaurada. Sincronizando tareas pendientes…");
    };

    // Cuando se pierde internet: actualiza el estado y notifica al usuario
    const off = () => {
      setOnline(false);
      notify("warning", "Sin conexión. Las acciones se guardarán localmente.");
    };

    // Escucha los eventos del navegador para detectar cambios en la conexión
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);

    // Función autoejecutable asíncrona: carga inicial de tareas
    (async () => {
      const local = await getAllTasksLocal();                    // Primero intenta obtener tareas guardadas localmente
      if (local?.length) setTasks(local.map(normalizeTask));    // Si hay tareas locales, las muestra de inmediato
      await loadFromServer();                                    // Luego carga desde el servidor
      await syncNow();                                           // Sincroniza operaciones pendientes (outbox)
      await loadFromServer();                                    // Vuelve a cargar para reflejar los cambios sincronizados
    })();

    // Limpieza al desmontar el componente: cancela suscripciones y listeners
    return () => {
      unsubscribe?.();                                           // Cancela la sincronización automática
      window.removeEventListener("online",  on);                // Elimina el listener de reconexión
      window.removeEventListener("offline", off);               // Elimina el listener de desconexión
    };
  }, []); // El [] vacío asegura que solo se ejecuta al montar

  // ─── Carga desde servidor ─────────────────────────────────────────────────

  // Pide las tareas al servidor, las normaliza, actualiza el estado y las guarda en local
  async function loadFromServer() {
    try {
      const { data } = await api.get("/tasks");                          // Petición GET al servidor
      const raw  = Array.isArray(data?.items) ? data.items : [];        // Extrae el array de tareas de la respuesta
      const list = raw.map(normalizeTask);                               // Normaliza cada tarea
      setTasks(list);                                                    // Actualiza la lista en pantalla
      await cacheTasks(list);                                            // Guarda las tareas en almacenamiento local
    } catch {
      // Si falla, se queda con los datos locales sin mostrar error (el usuario ya fue notificado antes)
    } finally {
      setLoading(false); // Quita el indicador de carga sin importar si hubo error o no
    }
  }

  // ─── Crear ────────────────────────────────────────────────────────────────

  // Maneja la creación de una nueva tarea al enviar el formulario
  async function addTask(e: React.FormEvent) {
    e.preventDefault();                       // Previene que la página se recargue al enviar el formulario
    const t = title.trim();                   // Quita espacios innecesarios del título
    const d = description.trim();             // Quita espacios innecesarios de la descripción
    if (!t) return;                           // Si no hay título, no hace nada

    const clienteId = crypto.randomUUID();    // Genera un ID único temporal para identificar la tarea antes de sincronizar

    // Crea la tarea localmente con el ID temporal
    const localTask = normalizeTask({
      _id: clienteId,
      title: t,
      description: d,
      status: "Pendiente" as Status,
      pending: !navigator.onLine,             // Si está offline, la marca como pendiente de sincronización
    });

    setTasks((prev) => [localTask, ...prev]); // Agrega la tarea al inicio de la lista en pantalla de forma inmediata
    await putTaskLocal(localTask);            // Guarda la tarea en almacenamiento local
    setTitle("");                             // Limpia el input de título
    setDescription("");                       // Limpia el textarea de descripción

    // Si no hay internet, encola la operación para sincronizarla después y termina
    if (!navigator.onLine) {
      const op: OutboxOp = {
        id: "op-" + clienteId,               // ID único de la operación en la cola
        op: "create",                         // Tipo de operación
        clienteId,                            // ID local de la tarea
        data: localTask,                      // Datos completos de la tarea
        ts: Date.now(),                       // Timestamp del momento en que se encoló
      };
      await queue(op);                        // Agrega la operación a la cola offline
      notify("warning", `"${t}" guardada offline. Se sincronizará cuando vuelva el internet.`);
      return;
    }

    // Si hay internet, intenta crear la tarea en el servidor
    try {
      const { data } = await api.post("/tasks", { title: t, description: d }); // POST al servidor
      const created  = normalizeTask(data?.task ?? data);                       // Normaliza la respuesta del servidor
      setTasks((prev) => prev.map((x) => (x._id === clienteId ? created : x))); // Reemplaza el ID temporal por el del servidor
      await putTaskLocal(created);                                               // Actualiza la tarea en local con el ID real
      notify("success", `Tarea "${t}" creada correctamente.`);
    } catch {
      // Si falla la petición, encola igualmente para sincronizar después
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

  // Activa el modo edición para una tarea, cargando sus datos actuales en los inputs de edición
  function startEdit(task: Task) {
    setEditingId(task._id);                          // Marca qué tarea se está editando
    setEditingTitle(task.title);                     // Carga el título actual en el input
    setEditingDescription(task.description ?? "");  // Carga la descripción actual (o vacío si no tiene)
  }

  // Guarda los cambios de la tarea que se está editando
  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();     // Título nuevo sin espacios extra
    const newDesc  = editingDescription.trim(); // Descripción nueva sin espacios extra
    if (!newTitle) return;                    // Si el título quedó vacío, no guarda

    const before  = tasks.find((t) => t._id === taskId);                    // Busca la tarea original para no perder otros campos
    const patched = { ...before, title: newTitle, description: newDesc } as Task; // Crea copia con los nuevos valores

    setTasks((prev) => prev.map((t) => (t._id === taskId ? patched : t))); // Actualiza en pantalla de inmediato
    await putTaskLocal(patched);                                             // Guarda cambios localmente
    setEditingId(null);                                                      // Sale del modo edición

    // Si no hay internet, encola la actualización
    if (!navigator.onLine) {
      await queue({
        id: "upd-" + taskId,
        op: "update",
        clienteId: isLocalId(taskId) ? taskId : undefined,   // Si el ID es local, lo manda como clienteId
        serverId:  isLocalId(taskId) ? undefined : taskId,   // Si el ID es del servidor, lo manda como serverId
        data: { title: newTitle, description: newDesc },
        ts: Date.now(),
      } as OutboxOp);
      notify("warning", `Cambios en "${newTitle}" guardados localmente. Pendiente de sincronización.`);
      return;
    }

    // Si hay internet, intenta actualizar en el servidor
    try {
      await api.put(`/tasks/${taskId}`, { title: newTitle, description: newDesc }); // PUT al servidor
      notify("success", `Tarea "${newTitle}" actualizada.`);
    } catch {
      // Si falla, encola para sincronizar después
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

  // Cambia el estado de una tarea (Pendiente / En Progreso / Completada)
  async function handleStatusChange(task: Task, newStatus: Status) {
    const updated = { ...task, status: newStatus };                              // Crea copia de la tarea con el nuevo estado
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));   // Actualiza en pantalla de inmediato
    await putTaskLocal(updated);                                                  // Guarda el cambio localmente

    // Si no hay internet, encola el cambio de estado
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

    // Si hay internet, intenta actualizar el estado en el servidor
    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus }); // PUT al servidor con solo el status
      notify("success", `"${task.title}" → ${newStatus}.`);
    } catch {
      // Si falla, encola para sincronizar después
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

  // Elimina una tarea por su ID
  async function removeTask(taskId: string) {
    const backup  = tasks;                                              // Guarda copia de la lista por si hay que hacer rollback
    const removed = tasks.find((t) => t._id === taskId);              // Guarda referencia de la tarea a eliminar (para el mensaje)
    setTasks((prev) => prev.filter((t) => t._id !== taskId));         // La elimina de la lista en pantalla de inmediato
    await removeTaskLocal(taskId);                                      // La elimina del almacenamiento local

    // Si no hay internet, encola la eliminación
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

    // Si hay internet, intenta eliminar en el servidor
    try {
      await api.delete(`/tasks/${taskId}`); // DELETE al servidor
      notify("info", `"${removed?.title}" eliminada.`);
    } catch {
      // Si falla: hace rollback (restaura la lista anterior) y encola para reintentarlo después
      setTasks(backup);                                                 // Restaura la lista como estaba antes
      for (const t of backup) await putTaskLocal(t);                  // Restaura cada tarea en el almacenamiento local
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

  // Cierra la sesión del usuario: elimina el token y redirige al inicio
  function logout() {
    localStorage.removeItem("token"); // Borra el token JWT del navegador
    setAuth(null);                    // Le dice a la API que ya no hay usuario autenticado
    window.location.href = "/";       // Redirige a la página de inicio
  }

  // ─── Filtros ──────────────────────────────────────────────────────────────

  // Calcula la lista filtrada según búsqueda y filtro activo; solo se recalcula si cambian tasks, search o filter
  const filtered = useMemo(() => {
    let list = tasks;

    // Filtra por texto: busca en título y descripción
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.title || "").toLowerCase().includes(s) ||
          (t.description || "").toLowerCase().includes(s)
      );
    }

    if (filter === "active")    list = list.filter((t) => t.status !== "Completada"); // Muestra solo las no completadas
    if (filter === "completed") list = list.filter((t) => t.status === "Completada"); // Muestra solo las completadas
    return list;
  }, [tasks, search, filter]);

  // Calcula estadísticas: total de tareas, cuántas están hechas y cuántas pendientes
  const stats = useMemo(() => {
    const total = tasks.length;
    const done  = tasks.filter((t) => t.status === "Completada").length;
    return { total, done, pending: total - done };
  }, [tasks]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    // Contenedor principal de toda la vista
    <div className="wrap">
      {/* Componente de notificaciones, siempre montado en pantalla */}
      <Notifications />

      {/* Barra superior con título, estadísticas, indicador de conexión y botón de salir */}
      <header className="topbar">
        <h1>To-Do Sofia</h1>
        <div className="spacer" /> {/* Espacio flexible que empuja el resto hacia la derecha */}
        <div className="stats">
          <span>Total: {stats.total}</span>
          <span>Hechas: {stats.done}</span>
          <span>Pendientes: {stats.pending}</span>
          {/* Badge que cambia de color según si hay conexión o no */}
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
        {/* ── Formulario para crear una nueva tarea ── */}
        <form className="add add-grid" onSubmit={addTask}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}       // Actualiza el estado con lo que escribe el usuario
            placeholder="Título de la tarea…"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)} // Actualiza el estado de la descripción
            placeholder="Descripción (opcional)…"
            rows={2}
          />
          <button className="btn">Agregar</button>
        </form>

        {/* ── Barra de búsqueda y botones de filtro ── */}
        <div className="toolbar">
          <input
            className="search"
            placeholder="Buscar por título o descripción…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}      // Actualiza el texto de búsqueda en tiempo real
          />
          <div className="filters">
            {/* Genera un botón por cada opción de filtro */}
            {(["all", "active", "completed"] as const).map((f) => (
              <button
                key={f}
                className={filter === f ? "chip active" : "chip"} // Resalta el filtro activo
                onClick={() => setFilter(f)}                       // Cambia el filtro al hacer clic
                type="button"
              >
                {{ all: "Todas", active: "Activas", completed: "Hechas" }[f]} {/* Traduce la clave al texto visible */}
              </button>
            ))}
          </div>
        </div>

        {/* ── Lista de tareas ── */}
        {loading ? (
          <p>Cargando…</p>                    // Mientras carga, muestra mensaje
        ) : filtered.length === 0 ? (
          <p className="empty">Sin tareas</p> // Si no hay tareas que mostrar (según filtro/búsqueda), avisa
        ) : (
          <ul className="list">
            {/* Renderiza cada tarea filtrada */}
            {filtered.map((t) => (
              <li
                key={t._id}
                className={t.status === "Completada" ? "item done" : "item"} // Aplica clase visual si está completada
              >
                {/* Selector de estado de la tarea */}
                <select
                  value={t.status}
                  onChange={(e) => handleStatusChange(t, e.target.value as Status)} // Llama a la función al cambiar
                  className="status-select"
                  title="Estado"
                >
                  <option value="Pendiente">Pendiente</option>
                  <option value="En Progreso">En Progreso</option>
                  <option value="Completada">Completada</option>
                </select>

                {/* Contenido de la tarea: modo edición o modo lectura */}
                <div className="content">
                  {editingId === t._id ? (
                    // Modo edición: muestra inputs con los valores actuales
                    <>
                      <input
                        className="edit"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        placeholder="Título"
                        autoFocus // Pone el cursor automáticamente en este input al entrar en edición
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
                    // Modo lectura: muestra el título, descripción y badge si no está sincronizada
                    <>
                      <span className="title" onDoubleClick={() => startEdit(t)}> {/* Doble clic activa la edición */}
                        {t.title}
                      </span>
                      {t.description && <p className="desc">{t.description}</p>} {/* Muestra descripción solo si existe */}
                      {/* Muestra badge de "Falta sincronizar" si la tarea es local o está pendiente */}
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

                {/* Botones de acción: guardar (en edición) o editar/eliminar (en lectura) */}
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
                    onClick={() => removeTask(t._id)} // Llama a la función de eliminación con el ID de la tarea
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