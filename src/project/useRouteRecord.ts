import { useEffect, useRef, useState } from "react";

import type * as api from "../api";
import type { PaginatedProject } from "./useProject";

/**
 * Resolves the `:recordId` route parameter against the loaded project. Records outside the loaded
 * timeline pages are fetched individually; `notFound` reports invalid IDs and records that do not
 * exist.
 */
export function useRouteRecord({
  project,
  recordId,
  enabled,
}: {
  project: PaginatedProject | null;
  recordId: number | null;
  enabled: boolean;
}): { record: api.ProjectRecord | null; notFound: boolean } {
  const [missingRecordId, setMissingRecordId] = useState<number | null>(null);
  const loadingRecordIdRef = useRef<number | null>(null);
  const recordIdIsValid = recordId === null || (Number.isSafeInteger(recordId) && recordId >= 1);
  const record =
    project && recordId !== null
      ? (project.records.find((candidate) => candidate.id === recordId) ?? null)
      : null;

  useEffect(() => {
    if (!enabled || recordId === null || !recordIdIsValid || !project || record) {
      return;
    }

    if (loadingRecordIdRef.current === recordId) {
      return;
    }

    let active = true;
    loadingRecordIdRef.current = recordId;
    setMissingRecordId(null);

    void project
      .loadRecord(recordId)
      .then((loaded) => {
        if (active && !loaded) {
          setMissingRecordId(recordId);
        }
      })
      .catch(() => {
        if (active) {
          setMissingRecordId(recordId);
        }
      })
      .finally(() => {
        if (loadingRecordIdRef.current === recordId) {
          loadingRecordIdRef.current = null;
        }
      });

    return () => {
      active = false;
    };
  }, [enabled, project, record, recordId, recordIdIsValid]);

  return {
    record,
    notFound: enabled && recordId !== null && (!recordIdIsValid || missingRecordId === recordId),
  };
}
