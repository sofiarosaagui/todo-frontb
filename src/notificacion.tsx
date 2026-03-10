// src/components/Notifications.tsx

// Importa hooks de React:
// - useEffect: para ejecutar código cuando el componente se monta/desmonta
// - useState: para guardar y actualizar la lista de notificaciones
// - useRef: para guardar los timers sin causar re-renders
import { useEffect, useState, useRef } from "react";

// Importa la función para escuchar notificaciones y el tipo de dato Notification
import { onNotification, type Notification } from "./offline/notificacion-bus";

// Tiempo en milisegundos que una notificación permanece visible antes de desaparecer sola (4.5 segundos)
const AUTO_DISMISS_MS = 4500;

// Objeto que define los colores y el ícono para cada tipo de notificación
// Record<Notification["type"], ...> significa que las claves son los tipos posibles: success, error, warning, info
const STYLES: Record<Notification["type"], { bg: string; border: string; icon: string }> = {
  success: { bg: "#0d2818",  border: "#22c55e", icon: "✅" }, // Verde para éxito
  error:   { bg: "#2a0a0a",  border: "#ef4444", icon: "❌" }, // Rojo para error
  warning: { bg: "#2a1a00",  border: "#f59e0b", icon: "⚠️" }, // Amarillo para advertencia
  info:    { bg: "#0c1a2e",  border: "#3b82f6", icon: "ℹ️" }, // Azul para información
};

// Componente principal que renderiza todas las notificaciones activas
export default function Notifications() {

  // Estado que guarda el arreglo de notificaciones actualmente visibles
  const [items, setItems] = useState<Notification[]>([]);

  // Referencia que guarda los timers de auto-dismiss por ID de notificación
  // Se usa useRef para que los timers persistan sin provocar re-renders
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Se ejecuta una sola vez al montar el componente (el [] vacío lo indica)
  useEffect(() => {

    // Se suscribe al bus de notificaciones; cada vez que llegue una nueva, ejecuta esta función
    const unsub = onNotification((n) => {

      // Agrega la nueva notificación al inicio del arreglo y limita la lista a 6 como máximo
      setItems((prev) => [n, ...prev].slice(0, 6));

      // Para que eliminencada cierto tiempo las notificaciones.
      timers.current[n.id] = setTimeout(() => {
        dismiss(n.id); // Elimina la notificación cuando expira el tiempo
      }, AUTO_DISMISS_MS);
    });

    // Función para que no reciba mas notificaciones
    return () => {
      unsub(); // Cancela la suscripción al bus de notificaciones
      Object.values(timers.current).forEach(clearTimeout); // Cancela todos los timers pendientes
    };
  }, []); // El [] vacío asegura que este efecto solo corre una vez

  // Función que elimina una notificación por su ID
  function dismiss(id: string) {
    clearTimeout(timers.current[id]); // Cancela el timer de esa notificación (por si se cierra manualmente antes de tiempo)
    delete timers.current[id];        // Elimina el timer del objeto de referencias
    setItems((prev) => prev.filter((n) => n.id !== id)); // Quita la notificación del estado (la elimina visualmente)
  }

  // Si no hay notificaciones activas, no renderiza nada
  if (!items.length) return null;

  return (
  
    <div
      style={{
        position: "fixed",        // Fijo en pantalla, no se mueve al hacer scroll
        bottom: 24,               // 24px desde la parte inferior
        right: 24,                // 24px desde la derecha
        zIndex: 9999,             // Encima de casi todo el contenido
        display: "flex",          // Usa flexbox para organizar las notificaciones
        flexDirection: "column-reverse", // Las nuevas notificaciones aparecen abajo; las viejas suben
        gap: 10,                  // Espacio de 10px entre cada notificación
        maxWidth: 360,            // Ancho máximo de 360px
        width: "calc(100vw - 48px)", // En pantallas pequeñas, ocupa el ancho disponible menos 48px de margen
      }}
    >
      {/* Recorre cada notificación y crea su tarjeta visual */}
      {items.map((n) => {
        const s = STYLES[n.type]; // Obtiene los estilos (color, ícono) según el tipo de notificación
        return (
          // Tarjeta individual de notificación
          <div
            key={n.id}           // Key única necesaria para que React identifique cada elemento en la lista
            role="alert"         // Indica a lectores de pantalla que es una alerta
            aria-live="polite"   // El lector de pantalla anunciará el contenido sin interrumpir al usuario
            style={{
              background: s.bg,                          // Color de fondo según el tipo
              border: `1px solid ${s.border}`,           // Borde coloreado según el tipo
              borderRadius: 10,                          // Esquinas redondeadas
              padding: "12px 16px",                      // Espacio interior
              display: "flex",                           // Flexbox para alinear ícono, texto y botón
              alignItems: "flex-start",                  // Alinea los elementos al inicio verticalmente
              gap: 10,                                   // Espacio entre ícono, mensaje y botón
              boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px ${s.border}22`, // Sombra exterior y brillo sutil del color
              animation: "slideIn 0.25s ease",           // Animación de entrada (definida más abajo)
              color: "#e5e7eb",                          // Color del texto (gris claro)
              fontSize: 14,                              // Tamaño de fuente
              lineHeight: 1.4,                           // Altura de línea para mejor lectura
            }}
          >
            {/* Barra vertical de color en el lado izquierdo de la tarjeta */}
            <div
              style={{
                position: "absolute",          // Se posiciona respecto al contenedor padre
                left: 0,                       // Pegado al borde izquierdo
                top: 0,                        // Desde arriba
                bottom: 0,                     // Hasta abajo (ocupa toda la altura)
                width: 4,                      // Grosor de 4px
                background: s.border,          // Color de la barra según el tipo
                borderRadius: "10px 0 0 10px", // Solo redondea las esquinas izquierdas
              }}
            />

            {/* Ícono del tipo de notificación (✅ ❌ ⚠️ ℹ️) */}
            <span style={{ fontSize: 18, flexShrink: 0, marginLeft: 6 }}>
              {s.icon} {/* Muestra el ícono correspondiente al tipo */}
            </span>

            {/* Texto del mensaje de la notificación */}
            <span style={{ flex: 1, wordBreak: "break-word" }}>
              {n.message} {/* Muestra el mensaje; wordBreak evita que palabras largas se salgan del contenedor */}
            </span>

            {/* Botón para cerrar manualmente la notificación */}
            <button
              onClick={() => dismiss(n.id)} // Al hacer clic, llama a dismiss con el ID de esta notificación
              title="Cerrar"               // Tooltip al pasar el mouse
              style={{
                background: "none",        // Sin fondo
                border: "none",            // Sin borde
                color: "#9ca3af",          // Color gris para el símbolo ×
                cursor: "pointer",         // Cambia el cursor a manito al pasar encima
                fontSize: 16,              // Tamaño del símbolo ×
                lineHeight: 1,             // Altura de línea ajustada
                padding: "0 0 0 4px",      // Pequeño padding izquierdo
                flexShrink: 0,             // Evita que el botón se encoja si el texto es largo
              }}
            >
              × {/* Símbolo de cerrar */}
            </button>
          </div>
        );
      })}

      {/* Definición de la animación slideIn directamente en el componente */}
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(40px); }  /* Empieza invisible y desplazada 40px a la derecha */
          to   { opacity: 1; transform: translateX(0); }     /* Termina visible en su posición normal */
        }
      `}</style>
    </div>
  );
}