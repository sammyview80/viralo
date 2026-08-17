export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-sm rounded-[12px] border border-c-border bg-surface-1 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold text-c-text">{title}</h2>
        <p className="mt-2 text-[13px] text-c-text-secondary">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-[8px] border border-c-border px-3.5 py-2 text-[13px] font-medium text-c-text-secondary hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={
              danger
                ? "rounded-[8px] bg-red-500 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                : "rounded-[8px] bg-[#ff3d6a] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#ff3d6a]/90 disabled:opacity-50"
            }
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
