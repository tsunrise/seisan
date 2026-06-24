import { useContext } from "react";

import { AppSnackbarContext } from "../components/AppSnackbarContext";

export function useAppSnackbar() {
  const value = useContext(AppSnackbarContext);
  if (!value) {
    throw new Error("useAppSnackbar must be used within AppSnackbarProvider.");
  }
  return value;
}
