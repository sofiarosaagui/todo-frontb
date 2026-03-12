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
      data: { 
        title: task.title,              // ✅ agregado
        description: task.description ?? "", // ✅ agregado
        status: newStatus 
      },
      ts: Date.now(),
    } as OutboxOp);
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
      data: { 
        title: task.title,              // ✅ agregado
        description: task.description ?? "", // ✅ agregado
        status: newStatus 
      },
      ts: Date.now(),
    } as OutboxOp);
    notify("warning", `Cambio de estado guardado localmente. Se sincronizará después.`);
  }
}