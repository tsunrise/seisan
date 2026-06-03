import { useEffect, useState } from "react";

import * as api from "../api";
import type { Loadable, User } from "../types";

export function useCurrentUser({ required }: { required: boolean }): Loadable<User | null> {
  const [state, setState] = useState<Loadable<User | null>>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    api
      .whoami()
      .then((user) => {
        if (active) {
          setState({ status: "ready", data: user, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof api.ApiError && error.status === 401 && !required) {
          setState({ status: "ready", data: null, error: null });
          return;
        }
        setState({ status: "error", data: null, error: "Please sign in." });
      });
    return () => {
      active = false;
    };
  }, [required]);

  return state;
}
