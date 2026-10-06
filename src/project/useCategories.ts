import * as api from "../api";
import { useLoadable } from "../hooks/useLoadable";
import type { Loadable } from "../types";

export function useCategories(): Loadable<api.Category[]> {
  return useLoadable(api.listCategories);
}
