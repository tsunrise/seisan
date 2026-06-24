import { createContext } from "react";

export type AppSnackbarSeverity = "success" | "error";

export interface AppSnackbarMessage {
  id: number;
  message: string;
  severity: AppSnackbarSeverity;
}

export interface AppSnackbarContextValue {
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

export const AppSnackbarContext = createContext<AppSnackbarContextValue | null>(null);
