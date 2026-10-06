import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  type DialogProps,
} from "@mui/material";
import type { ReactNode } from "react";

/**
 * Cancel/confirm dialog for destructive actions. While `busy`, both buttons are disabled and the
 * dialog ignores backdrop and Escape dismissal.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  confirmColor = "error",
  busy = false,
  maxWidth,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  confirmColor?: "error" | "warning";
  busy?: boolean;
  maxWidth?: DialogProps["maxWidth"];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const text = <DialogContentText>{description}</DialogContentText>;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      fullWidth
      maxWidth={maxWidth}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {children ? (
          <Stack spacing={2}>
            {text}
            {children}
          </Stack>
        ) : (
          text
        )}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button color={confirmColor} variant="contained" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
