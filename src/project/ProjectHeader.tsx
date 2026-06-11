import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { Box, IconButton, Stack, Typography } from "@mui/material";

import type * as api from "../api";
import { Amount } from "../components/Amount";
import { BrandLink } from "../components/BrandLink";
import { ledgerColors } from "../theme";

export function ProjectHeader({
  project,
  currentMember,
  onSettings,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
  onSettings: () => void;
}) {
  const balance = currentMember ? (project.balance[String(currentMember.id)] ?? 0) : null;
  const identityLabel = currentMember?.name ?? null;

  return (
    <Stack
      component="header"
      sx={{
        gap: 1.25,
        position: "sticky",
        top: 0,
        zIndex: 5,
        px: 2.5,
        py: 2,
        bgcolor: "background.paper",
        borderBottom: `1px solid ${ledgerColors.line}`,
      }}
    >
      <BrandLink size="compact" sx={{ display: { xs: "flex", lg: "none" } }} />
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="h1"
            sx={{
              fontSize: { xs: "1.875rem", md: "2rem", lg: "2.25rem" },
              overflowWrap: "normal",
              wordBreak: "normal",
            }}
          >
            {project.name}
          </Typography>
          {identityLabel ? (
            <Typography sx={{ mt: 0.75, fontWeight: 700 }}>
              {identityLabel} {balance !== null ? <Amount amount={balance} /> : null}
            </Typography>
          ) : null}
        </Box>
        <IconButton onClick={onSettings} aria-label="Project settings">
          <MoreHorizIcon />
        </IconButton>
      </Stack>
    </Stack>
  );
}
