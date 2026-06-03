import CheckIcon from "@mui/icons-material/Check";
import {
  Button,
  FormControl,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { Link, useLocation } from "react-router";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { panelFrameSx } from "../components/styles";
import { loginPath } from "../utils";

export function JoinPanel({
  project,
  currentEmail,
  currentMember,
  onReload,
  placement = "timeline",
}: {
  project: api.Project;
  currentEmail: string | null;
  currentMember: api.ProjectMember | null;
  onReload: () => void;
  placement?: "timeline" | "rail";
}) {
  const location = useLocation();
  const unlinkedMembers = project.members.filter(
    (member) => !member.deleted && !member.linkedEmail,
  );
  const [selection, setSelection] = useState(
    unlinkedMembers[0] ? `member:${unlinkedMembers[0].id}` : "new",
  );
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (currentMember) {
    return null;
  }

  const displaySx =
    placement === "timeline" ? { display: { xs: "block", md: "none" }, m: 2.5 } : undefined;

  if (!currentEmail) {
    return (
      <Paper square sx={{ ...panelFrameSx, ...displaySx }}>
        <Stack spacing={1.5}>
          <Typography color="text.secondary">Viewing as guest.</Typography>
          <Button component={Link} to={loginPath(location)} variant="contained" fullWidth>
            Sign in to join
          </Button>
        </Stack>
      </Paper>
    );
  }

  async function join() {
    setError(null);
    try {
      if (selection.startsWith("member:")) {
        await api.joinProject(project.id, { memberId: Number(selection.slice("member:".length)) });
      } else {
        await api.joinProject(project.id, { name });
      }
      onReload();
    } catch {
      setError("Could not join this project.");
    }
  }

  const canJoin = selection.startsWith("member:") || name.trim().length > 0;

  return (
    <Paper square sx={{ ...panelFrameSx, ...displaySx }}>
      <Stack spacing={1.5}>
        <Typography variant="h2">Join this project as</Typography>
        <FormControl>
          <RadioGroup
            aria-label="Join this project as"
            value={selection}
            onChange={(event) => setSelection(event.target.value)}
          >
            <Stack spacing={0.75}>
              {unlinkedMembers.map((member) => (
                <Stack
                  key={member.id}
                  component="label"
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", cursor: "pointer" }}
                >
                  <Radio value={`member:${member.id}`} />
                  <Typography>{member.name}</Typography>
                </Stack>
              ))}
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Radio value="new" />
                <TextField
                  placeholder="New Member"
                  value={name}
                  onChange={(event) => {
                    setSelection("new");
                    setName(event.target.value);
                  }}
                  onFocus={() => setSelection("new")}
                  fullWidth
                />
              </Stack>
            </Stack>
          </RadioGroup>
        </FormControl>
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <Button
          variant="contained"
          startIcon={<CheckIcon />}
          onClick={() => void join()}
          disabled={!canJoin}
          fullWidth
        >
          Join
        </Button>
      </Stack>
    </Paper>
  );
}
