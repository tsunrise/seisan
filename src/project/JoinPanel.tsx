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
import { MemberConfigFields } from "../components/MemberConfigFields";
import { PanelFrame } from "../components/PanelFrame";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { memberConfigDraft, memberConfigFromDraft } from "../memberConfig";
import { loginPath } from "../utils";

export function JoinPanel({
  project,
  currentEmail,
  currentMember,
  onReload,
}: {
  project: api.Project;
  currentEmail: string | null;
  currentMember: api.ProjectMemberFull | null;
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
  const [memberConfig, setMemberConfig] = useState(() =>
    memberConfigDraft(unlinkedMembers[0]?.config),
  );
  const [joining, setJoining] = useState(false);

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
    const config = memberConfigFromDraft(memberConfig);
    if (!config) {
      showError("Enter a whole number of at least 2 for the people you represent.");
      return;
    }
    setJoining(true);
    try {
      let joined: { member: api.ProjectMember };
      if (selection.startsWith("member:")) {
        joined = await api.joinProject(project.id, {
          memberId: Number(selection.slice("member:".length)),
        });
      } else {
        joined = await api.joinProject(project.id, { name });
      }
      try {
        await api.putMemberConfig(project.id, joined.member.id, config);
      } catch (error) {
        showError(
          `You joined, but profile details were not saved. Update them from Project info. ${getApiErrorMessage(error)}`,
        );
        onReload();
        navigate(`/project/${project.id}`, { replace: true });
        return;
      }
      showSuccess("Joined project.");
      onReload();
      navigate(`/project/${project.id}`, { replace: true });
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setJoining(false);
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
            onChange={(event) => {
              const nextSelection = event.target.value;
              setSelection(nextSelection);
              const selectedMember = nextSelection.startsWith("member:")
                ? unlinkedMembers.find(
                    (member) => member.id === Number(nextSelection.slice("member:".length)),
                  )
                : undefined;
              setMemberConfig(memberConfigDraft(selectedMember?.config));
            }}
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
                    if (selection !== "new") {
                      setMemberConfig(memberConfigDraft());
                    }
                    setSelection("new");
                    setName(event.target.value);
                  }}
                  onFocus={() => {
                    if (selection !== "new") {
                      setSelection("new");
                      setMemberConfig(memberConfigDraft());
                    }
                  }}
                  fullWidth
                />
              </Stack>
            </Stack>
          </RadioGroup>
        </FormControl>
        <Stack spacing={1.25}>
          <Typography variant="h3">Your details</Typography>
          <MemberConfigFields
            draft={memberConfig}
            onChange={setMemberConfig}
            isSelf
            disabled={joining}
          />
        </Stack>
        <Button
          variant="contained"
          startIcon={<CheckIcon />}
          onClick={() => void join()}
          disabled={!canJoin || joining}
          fullWidth
        >
          {joining ? "Joining…" : "Join"}
        </Button>
      </Stack>
    </PanelFrame>
  );
}
