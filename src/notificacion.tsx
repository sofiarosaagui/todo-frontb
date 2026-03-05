// src/components/Notifications.tsx
import { useEffect, useState, useRef } from "react";
import { onNotification, type Notification } from "./offline/notificacion-bus";

const AUTO_DISMISS_MS = 4500;

// Paleta visual por tipo
const STYLES: Record<Notification["type"], { bg: string; border: string; icon: string }> = {
  success: { bg: "#0d2818",  border: "#22c55e", icon: "✅" },
  error:   { bg: "#2a0a0a",  border: "#ef4444", icon: "❌" },
  warning: { bg: "#2a1a00",  border: "#f59e0b", icon: "⚠️" },
  info:    { bg: "#0c1a2e",  border: "#3b82f6", icon: "ℹ️" },
};

export default function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Registrar la suscripción al bus una sola vez
  useEffect(() => {
    const unsub = onNotification((n) => {
      setItems((prev) => [n, ...prev].slice(0, 6)); // máx 6 visibles

      // Auto-dismiss
      timers.current[n.id] = setTimeout(() => {
        dismiss(n.id);
      }, AUTO_DISMISS_MS);
    });

    return () => {
      unsub();
      Object.values(timers.current).forEach(clearTimeout);
    };
  }, []);

  function dismiss(id: string) {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setItems((prev) => prev.filter((n) => n.id !== id));
  }

  if (!items.length) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 10,
        maxWidth: 360,
        width: "calc(100vw - 48px)",
      }}
    >
      {items.map((n) => {
        const s = STYLES[n.type];
        return (
          <div
            key={n.id}
            role="alert"
            aria-live="polite"
            style={{
              background: s.bg,
              border: `1px solid ${s.border}`,
              borderRadius: 10,
              padding: "12px 16px",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px ${s.border}22`,
              animation: "slideIn 0.25s ease",
              color: "#e5e7eb",
              fontSize: 14,
              lineHeight: 1.4,
            }}
          >
            {/* Barra de color lateral */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                background: s.border,
                borderRadius: "10px 0 0 10px",
              }}
            />

            <span style={{ fontSize: 18, flexShrink: 0, marginLeft: 6 }}>
              {s.icon}
            </span>

            <span style={{ flex: 1, wordBreak: "break-word" }}>
              {n.message}
            </span>

            <button
              onClick={() => dismiss(n.id)}
              title="Cerrar"
              style={{
                background: "none",
                border: "none",
                color: "#9ca3af",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
                padding: "0 0 0 4px",
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        );
      })}

      {/* Keyframe inline para la animación */}
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}