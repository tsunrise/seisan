import AddIcon from "@mui/icons-material/Add";
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { FormEvent } from "react";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import * as api from "../api";
import { BackLink } from "../components/BackLink";
import { InlineAlert } from "../components/InlineAlert";
import { panelFrameSx } from "../components/styles";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { loginPath, parseEmailList } from "../utils";

export function CreateProjectPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useCurrentUser({ required: true });
  const [name, setName] = useState("Day Trip");
  const [ownerMemberName, setOwnerMemberName] = useState("");
  const [visibility, setVisibility] = useState<api.ProjectAcl["type"]>("public");
  const [emails, setEmails] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (user.status === "error") {
    return <Navigate to={loginPath(location)} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const acl =
      visibility === "public"
        ? ({ type: "public" } as const)
        : ({ type: "restricted", emails: parseEmailList(emails) } as const);
    try {
      const project = await api.createProject({
        name,
        ownerMemberName: ownerMemberName || undefined,
        acl,
      });
      navigate(`/project/${project.id}`);
    } catch {
      setError("Could not create the project.");
    }
  }

  return (
    <Box component="main" sx={{ minHeight: "100svh", display: "grid", placeItems: "center", p: 3 }}>
      <Box sx={{ width: "min(900px, 100%)" }}>
        <BackLink to="/projects" label="Projects" />
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(0, 420px) minmax(260px, 340px)" },
            gap: 3.5,
            alignItems: "start",
          }}
        >
          <Paper component="form" square onSubmit={submit} sx={panelFrameSx}>
            <Stack spacing={2}>
              <Typography variant="h1">New project</Typography>
              <TextField
                label="Project name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
              <TextField
                label="Your member name"
                placeholder="Defaults to your email"
                value={ownerMemberName}
                onChange={(event) => setOwnerMemberName(event.target.value)}
              />
              <FormControl>
                <InputLabel id="visibility-label">Visibility</InputLabel>
                <Select
                  labelId="visibility-label"
                  label="Visibility"
                  value={visibility}
                  onChange={(event) => setVisibility(event.target.value as api.ProjectAcl["type"])}
                >
                  <MenuItem value="public">Public</MenuItem>
                  <MenuItem value="restricted">Restricted</MenuItem>
                </Select>
              </FormControl>
              {visibility === "restricted" ? (
                <TextField
                  label="Allowed emails"
                  multiline
                  minRows={3}
                  value={emails}
                  onChange={(event) => setEmails(event.target.value)}
                  placeholder="alice@example.com, bob@example.com"
                />
              ) : null}
              {error ? <InlineAlert>{error}</InlineAlert> : null}
              <Button type="submit" variant="contained" startIcon={<AddIcon />}>
                Create
              </Button>
            </Stack>
          </Paper>
          <Paper square sx={{ ...panelFrameSx, display: { xs: "none", md: "block" } }}>
            <Typography
              sx={{
                color: "text.secondary",
                fontSize: 13,
                fontWeight: 900,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Preview
            </Typography>
            <Typography variant="h2">{name || "Untitled project"}</Typography>
            <Typography color="text.secondary">
              {visibility === "public" ? "Sharable by link" : "Restricted"}
            </Typography>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}
