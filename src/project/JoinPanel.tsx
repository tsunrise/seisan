import CheckIcon from "@mui/icons-material/Check";
import {
  Button,
  FormControl,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { InlineAlert } from "../components/InlineAlert";
import { PanelFrame } from "../components/PanelFrame";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { loginPath } from "../utils";

export function JoinPanel({
  project,
  currentEmail,
  currentMember,
  onReload,
}: {
  project: api.Project;
  currentEmail: string | null;
  currentMember: api.ProjectMember | null;
  onReload: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { showError, showSuccess } = useAppSnackbar();
  const unlinkedMembers = project.members.filter(
    (member) => !member.deleted && !member.linkedEmail,
  );
  const [selection, setSelection] = useState(
    unlinkedMembers[0] ? `member:${unlinkedMembers[0].id}` : "new",
  );
  const [name, setName] = useState("");

  if (currentMember) {
    return (
      <PanelFrame title="Join project" backTo={`/project/${project.id}`}>
        <InlineAlert>You are already a member of this project.</InlineAlert>
      </PanelFrame>
    );
  }

  if (!currentEmail) {
    return (
      <PanelFrame title="Join project" backTo={`/project/${project.id}`}>
        <Stack spacing={1.5}>
          <Typography variant="h2">Join this project</Typography>
          <Typography color="text.secondary">
            Sign in to claim your member and add records when you are ready.
          </Typography>
          <Button component={Link} to={loginPath(location)} variant="contained" fullWidth>
            Sign in to join
          </Button>
        </Stack>
      </PanelFrame>
    );
  }

  async function join() {
    try {
      if (selection.startsWith("member:")) {
        await api.joinProject(project.id, { memberId: Number(selection.slice("member:".length)) });
      } else {
        await api.joinProject(project.id, { name });
      }
      showSuccess("Joined project.");
      onReload();
      navigate(`/project/${project.id}`, { replace: true });
    } catch (error) {
      showError(getApiErrorMessage(error));
    }
  }

  const canJoin = selection.startsWith("member:") || name.trim().length > 0;

  return (
    <PanelFrame title="Join project" backTo={`/project/${project.id}`}>
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
    </PanelFrame>
  );
}
