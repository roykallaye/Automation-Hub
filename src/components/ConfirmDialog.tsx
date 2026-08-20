import { useEffect, useRef } from "react";

import { Button } from "./ui";

/**
 * A single confirmation dialog for the whole app.
 *
 * Focus moves to the dialog on open and Escape cancels, so a keyboard user is
 * never trapped behind a decision they cannot dismiss.
 */
export function ConfirmDialog({
  cancelLabel,
  confirmLabel,
  destructive = false,
  message,
  onCancel,
  onConfirm,
  title,
}: {
  cancelLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="ip-overlay" onClick={onCancel} role="presentation">
      <div
        aria-describedby="ip-dialog-message"
        aria-labelledby="ip-dialog-title"
        aria-modal="true"
        className="ip-dialog"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 id="ip-dialog-title">{title}</h2>
        <p id="ip-dialog-message">{message}</p>
        <div className="ip-dialog__actions">
          <Button onClick={onCancel} variant="ghost">
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} variant={destructive ? "danger" : "primary"}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
