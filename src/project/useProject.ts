import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../api";
import { loadableError } from "../hooks/useLoadable";
import type { Loadable } from "../types";

const PROJECT_RECORD_PAGE_SIZE = 50;

export type PaginatedProject = api.Project & {
  hasMoreRecords: boolean;
  loadingOlderRecords: boolean;
  loadOlderRecords: () => Promise<void>;
  loadRecord: (recordId: number) => Promise<api.ProjectRecord | null>;
};

type ProjectPagination = {
  hasMoreRecords: boolean;
  loadingOlderRecords: boolean;
};

type CachedProjectPage = {
  project: api.Project;
  hasMoreRecords: boolean;
};

const projectPageCache = new Map<string, CachedProjectPage>();

function mergeProjectRecord(project: api.Project, record: api.ProjectRecord): api.Project {
  const recordsById = new Map(project.records.map((item) => [item.id, item]));
  recordsById.set(record.id, record);
  return { ...project, records: [...recordsById.values()] };
}

export function useProject(projectId: string, reloadKey: number): Loadable<PaginatedProject> {
  const initialCachedPage = reloadKey === 0 ? projectPageCache.get(projectId) : undefined;
  const [state, setState] = useState<Loadable<api.Project>>(
    initialCachedPage
      ? { status: "ready", data: initialCachedPage.project, error: null }
      : {
          status: "loading",
          data: null,
          error: null,
        },
  );
  const [pagination, setPagination] = useState<ProjectPagination>({
    hasMoreRecords: initialCachedPage?.hasMoreRecords ?? false,
    loadingOlderRecords: false,
  });
  const projectRef = useRef<api.Project | null>(initialCachedPage?.project ?? null);
  const hasMoreRecordsRef = useRef(initialCachedPage?.hasMoreRecords ?? false);
  const loadingOlderRecordsRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    let active = true;
    generationRef.current += 1;
    const generation = generationRef.current;
    projectRef.current = null;
    hasMoreRecordsRef.current = false;
    loadingOlderRecordsRef.current = false;
    const cachedPage = reloadKey === 0 ? projectPageCache.get(projectId) : undefined;

    if (cachedPage) {
      projectRef.current = cachedPage.project;
      hasMoreRecordsRef.current = cachedPage.hasMoreRecords;
      queueMicrotask(() => {
        if (active && generation === generationRef.current) {
          setPagination({
            hasMoreRecords: cachedPage.hasMoreRecords,
            loadingOlderRecords: false,
          });
          setState({ status: "ready", data: cachedPage.project, error: null });
        }
      });
      return () => {
        active = false;
      };
    }

    queueMicrotask(() => {
      if (active && generation === generationRef.current) {
        setPagination({ hasMoreRecords: false, loadingOlderRecords: false });
        setState({ status: "loading", data: null, error: null });
      }
    });

    api
      .getProject(projectId, { limit: PROJECT_RECORD_PAGE_SIZE })
      .then((project) => {
        if (active && generation === generationRef.current) {
          projectRef.current = project;
          hasMoreRecordsRef.current = project.records.length === PROJECT_RECORD_PAGE_SIZE;
          setPagination({
            hasMoreRecords: hasMoreRecordsRef.current,
            loadingOlderRecords: false,
          });
          projectPageCache.set(projectId, {
            project,
            hasMoreRecords: hasMoreRecordsRef.current,
          });
          setState({ status: "ready", data: project, error: null });
        }
      })
      .catch((error: unknown) => {
        if (active && generation === generationRef.current) {
          projectRef.current = null;
          hasMoreRecordsRef.current = false;
          setPagination({ hasMoreRecords: false, loadingOlderRecords: false });
          setState(loadableError(error));
        }
      });
    return () => {
      active = false;
    };
  }, [projectId, reloadKey]);

  const loadOlderRecords = useCallback(async () => {
    const project = projectRef.current;
    if (!project || !hasMoreRecordsRef.current || loadingOlderRecordsRef.current) {
      return;
    }

    const earliestRecordId = project.records.reduce(
      (earliest, record) => Math.min(earliest, record.id),
      Number.MAX_SAFE_INTEGER,
    );
    if (!Number.isSafeInteger(earliestRecordId)) {
      hasMoreRecordsRef.current = false;
      setPagination((current) => ({ ...current, hasMoreRecords: false }));
      return;
    }

    loadingOlderRecordsRef.current = true;
    setPagination((current) => ({ ...current, loadingOlderRecords: true }));
    const generation = generationRef.current;

    try {
      const olderPage = await api.getProject(projectId, {
        limit: PROJECT_RECORD_PAGE_SIZE,
        offset: earliestRecordId,
      });
      if (generation === generationRef.current) {
        const existingRecordsById = new Map(project.records.map((record) => [record.id, record]));
        for (const record of olderPage.records) {
          existingRecordsById.set(record.id, record);
        }

        const mergedProject: api.Project = {
          ...olderPage,
          records: [...existingRecordsById.values()],
        };
        projectRef.current = mergedProject;
        hasMoreRecordsRef.current = olderPage.records.length === PROJECT_RECORD_PAGE_SIZE;
        projectPageCache.set(projectId, {
          project: mergedProject,
          hasMoreRecords: hasMoreRecordsRef.current,
        });
        setState({ status: "ready", data: mergedProject, error: null });
      }
    } catch (error) {
      if (generation === generationRef.current) {
        setState((current) => (current.status === "ready" ? current : loadableError(error)));
      }
    } finally {
      if (generation === generationRef.current && projectRef.current?.id === projectId) {
        loadingOlderRecordsRef.current = false;
        setPagination({
          hasMoreRecords: hasMoreRecordsRef.current,
          loadingOlderRecords: false,
        });
      }
    }
  }, [projectId]);

  const loadRecord = useCallback(
    async (recordId: number): Promise<api.ProjectRecord | null> => {
      if (!Number.isSafeInteger(recordId) || recordId < 1) {
        return null;
      }

      const currentProject = projectRef.current;
      const existingRecord = currentProject?.records.find((record) => record.id === recordId);
      if (existingRecord) {
        return existingRecord;
      }

      let record: api.ProjectRecord;
      try {
        record = await api.getRecord(projectId, recordId);
      } catch (error) {
        if (error instanceof api.ApiError && error.status === 404) {
          return null;
        }
        throw error;
      }

      const project = projectRef.current;
      if (!project) {
        return null;
      }
      const nextProject = mergeProjectRecord(project, record);
      projectRef.current = nextProject;
      projectPageCache.set(projectId, {
        project: nextProject,
        hasMoreRecords: hasMoreRecordsRef.current,
      });
      setState({ status: "ready", data: nextProject, error: null });
      return record;
    },
    [projectId],
  );

  if (state.status !== "ready") {
    return state;
  }

  return {
    status: "ready",
    data: {
      ...state.data,
      hasMoreRecords: pagination.hasMoreRecords,
      loadingOlderRecords: pagination.loadingOlderRecords,
      loadOlderRecords,
      loadRecord,
    },
    error: null,
  };
}
