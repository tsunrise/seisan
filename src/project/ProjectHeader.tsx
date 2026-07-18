import AccountCircleOutlinedIcon from "@mui/icons-material/AccountCircleOutlined";
import BalanceOutlinedIcon from "@mui/icons-material/BalanceOutlined";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { Box, Button, IconButton, Stack, Typography } from "@mui/material";
import { Link } from "react-router";

import type * as api from "../api";
import { accountLinkState } from "../account/navigation";
import { Amount } from "../components/Amount";
import { BrandLink } from "../components/BrandLink";
import { ledgerColors, ledgerFonts } from "../theme";

export function ProjectHeader({
  project,
  currentMember,
  showAccount,
  onSettings,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
  showAccount: boolean;
  onSettings: () => void;
}) {
  const balance = currentMember ? (project.balance[String(currentMember.id)] ?? 0) : null;
  const identityLabel = currentMember?.name ?? null;

  return (
    <Stack
      data-project-header=""
      component="header"
      sx={{
        gap: 1.25,
        position: "sticky",
        top: 0,
        zIndex: 5,
        px: { xs: 2.25, md: 2.5 },
        py: { xs: 1.75, md: 2 },
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
              fontFamily: ledgerFonts.serif,
              fontSize: { xs: "2rem", md: "2.35rem", lg: "2.55rem" },
              fontWeight: 500,
              letterSpacing: "-0.035em",
              lineHeight: 1,
              overflowWrap: "normal",
              wordBreak: "normal",
            }}
          >
            {project.name}
          </Typography>
          {identityLabel ? (
            <Stack
              direction="row"
              sx={{ alignItems: "center", flexWrap: "wrap", gap: 1.25, mt: 0.9 }}
            >
              <Typography sx={{ fontWeight: 760, lineHeight: 1.3 }}>
                {identityLabel} {balance !== null ? <Amount amount={balance} /> : null}
              </Typography>
              {balance !== null && balance !== 0 ? (
                <Button
                  component={Link}
                  to={`/project/${project.id}/settle`}
                  variant="text"
                  size="small"
                  startIcon={<BalanceOutlinedIcon />}
                  sx={{
                    fontSize: 13,
                    fontWeight: 750,
                    lineHeight: 1,
                    minHeight: 28,
                    p: 0,
                    "& .MuiButton-startIcon": { mr: 0.5 },
                    "& .MuiSvgIcon-root": { fontSize: 17 },
                  }}
                >
                  Settle up
                </Button>
              ) : null}
            </Stack>
          ) : null}
        </Box>
        <Stack direction="row" spacing={1}>
          {showAccount ? (
            <IconButton
              component={Link}
              to="/account"
              state={accountLinkState(project.name)}
              aria-label="Account"
              sx={{ display: { xs: "inline-flex", lg: "none" } }}
            >
              <AccountCircleOutlinedIcon />
            </IconButton>
          ) : null}
          <IconButton onClick={onSettings} aria-label="Project settings">
            <MoreHorizIcon />
          </IconButton>
        </Stack>
      </Stack>
    </Stack>
  );
}
