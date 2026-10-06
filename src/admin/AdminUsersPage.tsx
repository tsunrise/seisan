import {
  CircularProgress,
  Link as MuiLink,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";
import { useCallback } from "react";
import { Link, useSearchParams } from "react-router";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { formatRelativeTime } from "../domain";
import { useLoadable } from "../hooks/useLoadable";
import { AdminSurface, Pager, TableFrame } from "./AdminLayout";
import { ADMIN_PAGE_LIMIT, parseOffset, setOffsetParam } from "./adminSearchParams";

export function AdminUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const offset = parseOffset(searchParams.get("offset"));
  const load = useCallback(() => api.listAdminUsers({ limit: ADMIN_PAGE_LIMIT, offset }), [offset]);
  const state = useLoadable(load, "Could not load users.");

  function updateOffset(nextOffset: number) {
    const params = new URLSearchParams(searchParams);
    setOffsetParam(params, nextOffset);
    setSearchParams(params);
  }

  return (
    <AdminSurface title="Users">
      <Stack spacing={2}>
        {state.status === "loading" ? <CircularProgress size={24} /> : null}
        {state.status === "error" ? <InlineAlert>{state.error}</InlineAlert> : null}
        {state.status === "ready" ? (
          <>
            <TableFrame>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Owner</TableCell>
                    <TableCell align="right">Projects</TableCell>
                    <TableCell align="right">Records</TableCell>
                    <TableCell>Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.data.users.map((user) => (
                    <TableRow key={user.owner} hover>
                      <TableCell>
                        <MuiLink
                          component={Link}
                          to={`/admin/projects?ownerEmail=${encodeURIComponent(user.owner)}`}
                        >
                          {user.owner}
                        </MuiLink>
                      </TableCell>
                      <TableCell align="right">{user.projectCount.toLocaleString()}</TableCell>
                      <TableCell align="right">{user.recordCount.toLocaleString()}</TableCell>
                      <TableCell>{formatRelativeTime(user.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
            <Pager page={state.data.page} onOffset={updateOffset} />
          </>
        ) : null}
      </Stack>
    </AdminSurface>
  );
}
