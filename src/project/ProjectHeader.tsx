import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { Box, IconButton, Link, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router";

import type * as api from "../api";
import { accountLinkState } from "../account/navigation";
import { Amount } from "../components/Amount";
import { BrandLink } from "../components/BrandLink";
import { ledgerColors, ledgerFonts } from "../theme";

export function ProjectHeader({
  project,
  currentMember,
  currentEmail,
  onSettings,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
  currentEmail: string | null;
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
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          display: { xs: "flex", lg: "none" },
        }}
      >
        <BrandLink size="compact" />
        {currentEmail ? (
          <Typography
            component={RouterLink}
            to="/account"
            state={accountLinkState(project.name)}
            aria-label={`Open account for ${currentEmail}`}
            title={currentEmail}
            sx={{
              minWidth: 0,
              maxWidth: { xs: "58%", sm: "64%" },
              overflow: "hidden",
              color: "text.secondary",
              fontSize: 11,
              fontWeight: 560,
              lineHeight: 1.2,
              textDecoration: "none",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              transition: "color 160ms ease",
              "&:hover": {
                color: "text.primary",
                textDecoration: "underline",
                textDecorationColor: ledgerColors.lineStrong,
                textUnderlineOffset: "0.25em",
              },
              "&:focus-visible": {
                borderRadius: 0.5,
                outline: `2px solid ${ledgerColors.blue}`,
                outlineOffset: 3,
              },
            }}
          >
            {currentEmail}
          </Typography>
        ) : null}
      </Stack>
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          position: "relative",
        }}
      >
        <Box sx={{ minWidth: 0, width: "100%" }}>
          <Typography
            variant="h1"
            sx={{
              fontFamily: ledgerFonts.serif,
              fontSize: { xs: "2rem", md: "2.35rem", lg: "2.55rem" },
              fontWeight: 500,
              letterSpacing: "-0.035em",
              lineHeight: 1,
              overflowWrap: "normal",
              pr: 7,
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
                <Link
                  component={RouterLink}
                  to={`/project/${project.id}/settle`}
                  underline="always"
                  sx={{
                    alignItems: "center",
                    color: ledgerColors.blue,
                    display: "inline-flex",
                    flexShrink: 0,
                    fontSize: 13,
                    fontWeight: 750,
                    lineHeight: 1,
                    minHeight: 28,
                    textDecorationColor: "currentColor",
                    textUnderlineOffset: "0.22em",
                    transition: "color 160ms ease, text-decoration-thickness 160ms ease",
                    "&:hover": {
                      color: ledgerColors.blueDark,
                      textDecorationThickness: "0.12em",
                    },
                    "&:focus-visible": {
                      borderRadius: 0.5,
                      outline: `2px solid ${ledgerColors.blue}`,
                      outlineOffset: 2,
                    },
                  }}
                >
                  View transfer plan
                </Link>
              ) : null}
            </Stack>
          ) : null}
        </Box>
        <Stack
          direction="row"
          spacing={1}
          sx={{ position: "absolute", right: 0, top: { xs: -0.5, md: 0 } }}
        >
          <IconButton onClick={onSettings} aria-label="Project settings">
            <MoreHorizIcon />
          </IconButton>
        </Stack>
      </Stack>
    </Stack>
  );
}
