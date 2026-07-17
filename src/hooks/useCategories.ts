import { useEffect, useState } from "react";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import type { Loadable } from "../types";

export function useCategories(): Loadable<api.Category[]> {
  const [state, setState] = useState<Loadable<api.Category[]>>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    api
      .listCategories()
      .then((categories) => {
        if (active) {
          setState({ status: "ready", data: categories, error: null });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            data: null,
            error: getApiErrorMessage(error),
            errorCode: error instanceof api.ApiError ? error.code : null,
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}
