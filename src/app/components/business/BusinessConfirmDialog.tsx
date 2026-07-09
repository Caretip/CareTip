import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";

type BusinessConfirmDialogProps = {
  open: boolean;
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  confirming?: boolean;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Shared destructive-action confirmation (matches staff delete / deactivate modals). */
export function BusinessConfirmDialog({
  open,
  title,
  body,
  cancelLabel,
  confirmLabel,
  confirming = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: BusinessConfirmDialogProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-xl font-bold text-foreground">{title}</h2>
        <p className="mb-6 text-sm text-muted-foreground">{body}</p>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={confirming}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="flex-1"
            disabled={confirmDisabled || confirming}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
