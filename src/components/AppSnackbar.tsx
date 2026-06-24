import { Alert, Snackbar } from "@mui/material";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import {
  AppSnackbarContext,
  type AppSnackbarContextValue,
  type AppSnackbarMessage,
  type AppSnackbarSeverity,
} from "./AppSnackbarContext";

interface AppSnackbarState {
  current: AppSnackbarMessage | null;
  open: boolean;
  queue: AppSnackbarMessage[];
}

export function AppSnackbarProvider({ children }: { children: ReactNode }) {
  const nextIdRef = useRef(1);
  const [state, setState] = useState<AppSnackbarState>({
    current: null,
    open: false,
    queue: [],
  });

  const enqueue = useCallback((severity: AppSnackbarSeverity, message: string) => {
    setState((currentState) => {
      const nextMessage = {
        id: nextIdRef.current++,
        message,
        severity,
      };

      if (!currentState.current) {
        return {
          current: nextMessage,
          open: true,
          queue: currentState.queue,
        };
      }

      return {
        ...currentState,
        queue: [...currentState.queue, nextMessage],
      };
    });
  }, []);

  const value = useMemo<AppSnackbarContextValue>(
    () => ({
      showError: (message) => enqueue("error", message),
      showSuccess: (message) => enqueue("success", message),
    }),
    [enqueue],
  );

  function closeSnackbar(_: unknown, reason?: string) {
    if (reason === "clickaway") {
      return;
    }
    setState((currentState) => ({ ...currentState, open: false }));
  }

  function showNextSnackbar() {
    setState((currentState) => {
      const [next, ...rest] = currentState.queue;
      if (!next) {
        return {
          current: null,
          open: false,
          queue: [],
        };
      }

      return {
        current: next,
        open: true,
        queue: rest,
      };
    });
  }

  return (
    <AppSnackbarContext.Provider value={value}>
      {children}
      <Snackbar
        key={state.current?.id}
        open={state.open}
        autoHideDuration={5000}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        onClose={closeSnackbar}
        slotProps={{
          transition: {
            onExited: showNextSnackbar,
          },
        }}
      >
        <Alert
          severity={state.current?.severity ?? "success"}
          variant="filled"
          onClose={closeSnackbar}
          sx={{
            maxWidth: "min(560px, calc(100vw - 32px))",
            "& .MuiAlert-action": {
              alignItems: "center",
              color: "inherit",
              pl: 2,
            },
            "& .MuiAlert-action .MuiIconButton-root": {
              border: 0,
              bgcolor: "transparent",
              color: "inherit",
              "&:hover": {
                bgcolor: "rgba(255, 255, 255, 0.16)",
              },
            },
            "& .MuiAlert-action .MuiSvgIcon-root": {
              color: "inherit",
            },
          }}
        >
          {state.current?.message}
        </Alert>
      </Snackbar>
    </AppSnackbarContext.Provider>
  );
}
