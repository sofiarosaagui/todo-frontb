// Bus de eventos desacoplado de React — puede usarse desde sync.ts, db.ts, etc.
// Es decir, este archivo funciona como un "mensajero central" que cualquier parte
// de la app puede usar para enviar o recibir notificaciones, sin depender de React

// Define los únicos valores posibles para el tipo de notificación
export type NotifType = "success" | "error" | "warning" | "info";

// Define la estructura de datos de una notificación
export interface Notification {
  id: string;      // Identificador único de la notificación
  type: NotifType; // Tipo de notificación (éxito, error, advertencia, info)
  message: string; // Texto que se mostrará al usuario
  ts: number;      // Timestamp: momento exacto en que se creó la notificación
}

// Define el tipo de las funciones que pueden escuchar notificaciones
// Una Listener es cualquier función que recibe una Notification y no devuelve nada
type Listener = (n: Notification) => void;

// Conjunto (Set) que almacena todas las funciones suscritas para recibir notificaciones
// Se usa Set en lugar de Array para evitar duplicados automáticamente
// o sea que notificación.tsx o cualquier otro puede ser llamado y notificarlo cada que hay una notificación
const listeners = new Set<Listener>();

/** Suscribirse a notificaciones. Devuelve una función para des-suscribirse. */
// Permite que cualquier parte de la app se suscriba para recibir notificaciones
export function onNotification(cb: Listener): () => void {
  listeners.add(cb);              // Agrega la función al conjunto de oyentes
  return () => listeners.delete(cb); // Devuelve una función que, al llamarse, elimina este oyente (des-suscripción)
}

/** Emitir una notificación. Llamable desde cualquier módulo TS/JS. */
// Crea y envía una notificación a todos los que estén suscritos
export function notify(type: NotifType, message: string): void {
  const n: Notification = {
    id: crypto.randomUUID(), // Genera un ID único para esta notificación
    type,                    // Tipo recibido como parámetro (success, error, etc.)
    message,                 // Mensaje recibido como parámetro
    ts: Date.now(),          // Guarda el momento exacto en que se emitió
  };
  listeners.forEach((cb) => cb(n)); // Llama a cada función suscrita y le pasa la notificación recién creada
}
//Basicamente este le cotifica a notificacion.tsx lo que esta fallando para que lo muestre al usuario. 