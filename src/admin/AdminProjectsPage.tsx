import CheckIcon from "@mui/icons-material/Check";
import {
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  Link as MuiLink,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type { FormEvent } from "react";
import { useCallback } from "react";
import { Link, useSearchParams } from "react-router";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { formatRelativeTime } from "../domain";
import { useLoadable } from "../hooks/useLoadable";
import { projectPaths } from "../project/paths";
import { AdminSurface, Pager, TableFrame } from "./AdminLayout";
import {
  ADMIN_PAGE_LIMIT,
  parseOffset,
  parseProjectSort,
  projectSortOptions,
  setOffsetParam,
} from "./adminSearchParams";

export function AdminProjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerEmail = searchParams.get("ownerEmail") ?? "";
  const sort = parseProjectSort(searchParams.get("sort"));
  const offset = parseOffset(searchParams.get("offset"));
  const load = useCallback(
    () =>
      api.listAdminProjects({
        limit: ADMIN_PAGE_LIMIT,
        offset,
        ...(ownerEmail ? { ownerEmail } : {}),
        sort,
      }),
    [offset, ownerEmail, sort],
  );
  const state = useLoadable(load, "Could not load projects.");

  function updateParams(next: {
    ownerEmail?: string;
    sort?: api.AdminProjectSort;
    offset?: number;
  }) {
    const params = new URLSearchParams(searchParams);
    if (next.ownerEmail !== undefined) {
      const trimmed = next.ownerEmail.trim();
      if (trimmed) {
        params.set("ownerEmail", trimmed);
      } else {
        params.delete("ownerEmail");
      }
      params.delete("offset");
    }
    if (next.sort !== undefined) {
      params.set("sort", next.sort);
      params.delete("recordOrder");
      params.delete("offset");
    }
    if (next.offset !== undefined) {
      setOffsetParam(params, next.offset);
    }
    setSearchParams(params);
  }

  function submitOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updateParams({ ownerEmail: String(data.get("ownerEmail") ?? "") });
  }

  return (
    <AdminSurface title="Projects">
      <Stack spacing={2}>
        <Stack
          component="form"
          direction={{ xs: "column", lg: "row" }}
          spacing={1.25}
          onSubmit={submitOwner}
        >
          <TextField
            key={ownerEmail}
            name="ownerEmail"
            label="Owner email"
            type="email"
            defaultValue={ownerEmail}
            sx={{ flex: 1 }}
          />
          <FormControl sx={{ minWidth: 180 }}>
            <InputLabel id="project-order-label">Order</InputLabel>
            <Select
              labelId="project-order-label"
              label="Order"
              value={sort}
              onChange={(event) =>
                updateParams({ sort: event.target.value as api.AdminProjectSort })
              }
            >
              {projectSortOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button type="submit" variant="outlined" startIcon={<CheckIcon />}>
            Filter
          </Button>
        </Stack>
        {state.status === "loading" ? <CircularProgress size={24} /> : null}
        {state.status === "error" ? <InlineAlert>{state.error}</InlineAlert> : null}
        {state.status === "ready" ? (
          <>
            <TableFrame>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Project</TableCell>
                    <TableCell>Owner</TableCell>
                    <TableCell align="right">Records</TableCell>
                    <TableCell align="right">Members</TableCell>
                    <TableCell>Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.data.projects.map((project) => (
                    <TableRow key={project.id} hover>
                      <TableCell>
                        <MuiLink component={Link} to={projectPaths.timeline(project.id)}>
                          {project.name}
                        </MuiLink>
                      </TableCell>
                      <TableCell>{project.owner}</TableCell>
                      <TableCell align="right">{project.recordCount.toLocaleString()}</TableCell>
                      <TableCell align="right">{project.memberCount.toLocaleString()}</TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: 13 }}>
                          {formatRelativeTime(project.updatedAt)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
            <Pager
              page={state.data.page}
              onOffset={(nextOffset) => updateParams({ offset: nextOffset })}
            />
          </>
        ) : null}
      </Stack>
    </AdminSurface>
  );
}
