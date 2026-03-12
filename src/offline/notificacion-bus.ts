export type NotifType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;      
  type: NotifType; 
  message: string; 
  ts: number;      
}

type Listener = (n: Notification) => void;


const listeners = new Set<Listener>();


export function onNotification(cb: Listener): () => void {
  listeners.add(cb);              
  return () => listeners.delete(cb); 
}


export function notify(type: NotifType, message: string): void {
  const n: Notification = {
    id: crypto.randomUUID(), 
    type,                    
    message,                 
    ts: Date.now(),          
  };
  listeners.forEach((cb) => cb(n)); 
}
