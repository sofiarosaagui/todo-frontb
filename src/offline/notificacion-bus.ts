// Bus de eventos desacoplado de React  puede usarse desde sync.ts, db.ts, etc.

export type NotifType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotifType;
  message: string;
  ts: number;
}

type Listener = (n: Notification) => void;

const listeners = new Set<Listener>();

/** Suscribirse a notificaciones. Devuelve una función para des-suscribirse. */
export function onNotification(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Emitir una notificación. Llamable desde cualquier módulo TS/JS. */
export function notify(type: NotifType, message: string): void {
  const n: Notification = {
    id: crypto.randomUUID(),
    type,
    message,
    ts: Date.now(),
  };
  listeners.forEach((cb) => cb(n));
}