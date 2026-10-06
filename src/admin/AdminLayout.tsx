import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Alert, Box, IconButton, Paper, Snackbar, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

import type * as api from "../api";
import { paperFrameSx } from "../components/styles";

export function AdminSurface({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper square sx={{ ...paperFrameSx, minWidth: 0, p: { xs: 2, md: 2.5 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">{title}</Typography>
        {children}
      </Stack>
    </Paper>
  );
}

export function TableFrame({ children }: { children: ReactNode }) {
  return <Box sx={{ width: "100%", overflowX: "auto" }}>{children}</Box>;
}

export function Pager({
  page,
  onOffset,
}: {
  page: api.AdminPage;
  onOffset: (offset: number) => void;
}) {
  const firstItem = page.total === 0 ? 0 : page.offset + 1;
  const lastItem = Math.min(page.offset + page.limit, page.total);
  return (
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}>
      <Typography color="text.secondary" sx={{ fontSize: 13 }}>
        {firstItem}-{lastItem} of {page.total}
      </Typography>
      <Stack direction="row" spacing={1}>
        <IconButton
          aria-label="Previous page"
          disabled={page.offset === 0}
          onClick={() => onOffset(Math.max(0, page.offset - page.limit))}
        >
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <IconButton
          aria-label="Next page"
          disabled={!page.hasMore}
          onClick={() => onOffset(page.offset + page.limit)}
        >
          <ArrowBackIcon fontSize="small" sx={{ transform: "rotate(180deg)" }} />
        </IconButton>
      </Stack>
    </Stack>
  );
}

export function SavedSnackbar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Snackbar
      open={open}
      autoHideDuration={3000}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
    >
      <Alert severity="success" variant="filled">
        Saved.
      </Alert>
    </Snackbar>
  );
}
