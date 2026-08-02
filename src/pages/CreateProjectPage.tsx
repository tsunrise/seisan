import AddIcon from "@mui/icons-material/Add";
import { Box, Button, Divider, Paper, Stack, TextField, Typography } from "@mui/material";
import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { BackLink } from "../components/BackLink";
import { BrandLink } from "../components/BrandLink";
import { MemberConfigFields } from "../components/MemberConfigFields";
import { panelFrameSx } from "../components/styles";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { memberConfigDraft, memberConfigFromDraft } from "../memberConfig";
import { ledgerColors, ledgerFonts } from "../theme";
import { loginPath } from "../utils";

export function CreateProjectPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showError, showSuccess } = useAppSnackbar();
  const user = useCurrentUser({ required: true });
  const [name, setName] = useState("");
  const [ownerMemberName, setOwnerMemberName] = useState("");
  const [memberConfig, setMemberConfig] = useState(() => memberConfigDraft());
  const [creating, setCreating] = useState(false);
  useDocumentTitle("New project - Seisan");

  if (user.status === "error") {
    return <Navigate to={loginPath(location)} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const config = memberConfigFromDraft(memberConfig);
    if (!config) {
      showError("Enter a whole number of at least 2 for the people you represent.");
      return;
    }
    if (Object.keys(config).length > 0 && !ownerMemberName.trim()) {
      showError("Enter your member name to save your transfer and group details.");
      return;
    }
    setCreating(true);
    try {
      const project = await api.createProject({
        name,
        ownerMemberName: ownerMemberName.trim() || undefined,
        acl: { type: "public" },
      });
      const ownerMember = project.members.find((member) => member.linkedEmail === project.owner);
      try {
        if (Object.keys(config).length > 0 && !ownerMember) {
          throw new Error("The created project did not return its owner member.");
        }
        if (ownerMember && Object.keys(config).length > 0) {
          await api.putMemberConfig(project.id, ownerMember.id, config);
        }
      } catch (error) {
        showError(
          `Project created, but profile details were not saved. Update them from Project info. ${getApiErrorMessage(error)}`,
        );
        navigate(`/project/${project.id}`);
        return;
      }
      showSuccess("Project created.");
      navigate(`/project/${project.id}`);
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100svh",
        display: "grid",
        alignItems: "center",
        px: { xs: 2, sm: 3, lg: 5 },
        py: { xs: 2.5, sm: 4, lg: 6 },
      }}
    >
      <Box
        sx={{
          width: "min(1120px, 100%)",
          mx: "auto",
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "minmax(240px, 0.72fr) minmax(0, 1.28fr)" },
          columnGap: { md: 6, lg: 9 },
          rowGap: { xs: 3, sm: 4 },
          alignItems: "start",
        }}
      >
        <Box component="header" sx={{ pt: { md: 1.5 } }}>
          <BrandLink to="/projects" ariaLabel="Go to projects" sx={{ mb: { xs: 3, md: 5 } }} />
          <BackLink to="/projects" label="Projects" />
          <Typography
            variant="h1"
            sx={{
              maxWidth: 380,
              fontFamily: ledgerFonts.serif,
              fontSize: { xs: "2.5rem", sm: "3rem", md: "3.4rem" },
              fontWeight: 650,
              letterSpacing: "-0.035em",
              lineHeight: 0.98,
              textWrap: "balance",
            }}
          >
            New project
          </Typography>
          <Typography
            color="text.secondary"
            sx={{ mt: 2, maxWidth: 360, fontSize: { xs: 15, sm: 16 }, lineHeight: 1.65 }}
          >
            Give your group a shared place to record expenses and work out who should transfer what.
          </Typography>
          <Box
            sx={{
              display: { xs: "none", md: "block" },
              width: 48,
              mt: 4,
              borderTop: `2px solid ${ledgerColors.blue}`,
            }}
          />
          <Typography
            color="text.secondary"
            sx={{ display: { xs: "none", md: "block" }, mt: 1.5, maxWidth: 310, fontSize: 13.5 }}
          >
            You can add members and adjust project settings after creation.
          </Typography>
        </Box>

        <Paper
          component="form"
          square
          onSubmit={submit}
          sx={{
            ...panelFrameSx,
            width: "100%",
            maxWidth: 720,
            justifySelf: "end",
            p: 0,
            overflow: "hidden",
            boxShadow: `0 18px 48px ${ledgerColors.shadowInk}`,
          }}
        >
          <Box component="section" aria-labelledby="project-name-heading" sx={formSectionSx}>
            <SectionHeading
              number="01"
              id="project-name-heading"
              title="Project name"
              description="Choose a short name your group will recognize."
            />
            <TextField
              label="Project name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
              fullWidth
            />
          </Box>

          <Divider />

          <Box component="section" aria-labelledby="your-role-heading" sx={formSectionSx}>
            <SectionHeading
              number="02"
              id="your-role-heading"
              title="Your role"
              description="Set how you appear in this project and how members can pay you."
            />
            <Stack spacing={2}>
              <TextField
                label="Your name in project"
                value={ownerMemberName}
                onChange={(event) => setOwnerMemberName(event.target.value)}
                helperText="This name is visible to the other project members."
                fullWidth
              />
              <MemberConfigFields draft={memberConfig} onChange={setMemberConfig} isSelf />
            </Stack>
          </Box>

          <Stack
            component="footer"
            direction={{ xs: "column-reverse", sm: "row" }}
            sx={{
              alignItems: { xs: "stretch", sm: "center" },
              justifyContent: "space-between",
              gap: 1.25,
              px: { xs: 2.5, sm: 4 },
              py: { xs: 2.25, sm: 2.5 },
              bgcolor: ledgerColors.paperSoft,
              borderTop: `1px solid ${ledgerColors.line}`,
            }}
          >
            <Button component={Link} to="/projects" color="inherit" sx={{ px: 1.25 }}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              startIcon={<AddIcon />}
              disabled={creating}
              sx={{ minWidth: { sm: 176 } }}
            >
              {creating ? "Creating…" : "Create project"}
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}

const formSectionSx = {
  px: { xs: 2.5, sm: 4 },
  py: { xs: 3, sm: 4 },
};

function SectionHeading({
  number,
  id,
  title,
  description,
}: {
  number: string;
  id: string;
  title: string;
  description: string;
}) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr)", gap: 1.5, mb: 2.5 }}>
      <Typography
        aria-hidden="true"
        sx={{ color: ledgerColors.blue, fontFamily: ledgerFonts.mono, fontSize: 12, pt: 0.5 }}
      >
        {number}
      </Typography>
      <Box>
        <Typography id={id} variant="h2" sx={{ fontFamily: ledgerFonts.serif, fontWeight: 650 }}>
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 500, fontSize: 14 }}>
          {description}
        </Typography>
      </Box>
    </Box>
  );
}
