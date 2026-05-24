import { useToasts, dismissToast } from "./store";

export function ToastContainer() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.variant}`}>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message ? <div className="toast-msg">{t.message}</div> : null}
          </div>
          {t.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action?.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
