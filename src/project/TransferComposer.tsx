import AddIcon from "@mui/icons-material/Add";
import { Button, MenuItem, Stack, TextField } from "@mui/material";
import type { FormEvent } from "react";
import { useState } from "react";
import { useNavigate } from "react-router";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { InlineAlert } from "../components/InlineAlert";
import { MoneyTable } from "../components/MoneyTable";
import { PanelFrame } from "../components/PanelFrame";
import { activeMembers, deriveDelta, parseCents } from "../domain";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { RecordFormBridge } from "./RecordFormBridge";
import { RecordSentenceField, RecordSentenceRow } from "./RecordSentenceRow";

export function TransferComposer({
  project,
  currentMember,
  onPosted,
  onBack,
}: {
  project: api.Project;
  currentMember: api.ProjectMember;
  onPosted: () => void;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { showError, showSuccess } = useAppSnackbar();
  const members = activeMembers(project.members);
  const [from, setFrom] = useState(currentMember.id);
  const [to, setTo] = useState(
    members.find((member) => member.id !== currentMember.id)?.id ?? currentMember.id,
  );
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cents = parseCents(amount);
  const description: api.RecordDescription =
    cents === null
      ? { type: "transfer", from, to, amount: 0 }
      : { type: "transfer", from, to, amount: cents };
  const delta = deriveDelta(description);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (cents === null || cents <= 0 || from === to) {
      setError("Choose two members and a positive amount.");
      return;
    }
    try {
      await api.appendRecord(project.id, { description, delta });
      showSuccess("Record posted.");
      onPosted();
      navigate(`/project/${project.id}`);
    } catch (error) {
      showError(getApiErrorMessage(error));
    }
  }

  return (
    <PanelFrame title="New transfer" backTo={`/project/${project.id}/records/new`} onBack={onBack}>
      <Stack component="form" spacing={2} onSubmit={submit}>
        <RecordSentenceRow>
          <RecordSentenceField minWidth={148}>
            <TextField
              select
              label="From"
              value={String(from)}
              onChange={(event) => setFrom(Number(event.target.value))}
            >
              {members.map((member) => (
                <MenuItem key={member.id} value={String(member.id)}>
                  {member.name}
                </MenuItem>
              ))}
            </TextField>
          </RecordSentenceField>
          <RecordFormBridge>paid</RecordFormBridge>
          <RecordSentenceField minWidth={148}>
            <TextField
              select
              label="To"
              value={String(to)}
              onChange={(event) => setTo(Number(event.target.value))}
            >
              {members.map((member) => (
                <MenuItem key={member.id} value={String(member.id)}>
                  {member.name}
                </MenuItem>
              ))}
            </TextField>
          </RecordSentenceField>
          <RecordSentenceField minWidth={120}>
            <TextField
              label="Amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="12.34"
              required
            />
          </RecordSentenceField>
        </RecordSentenceRow>
        <MoneyTable title="Preview" project={project} map={delta} />
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <Button type="submit" variant="contained" startIcon={<AddIcon />}>
          Post
        </Button>
      </Stack>
    </PanelFrame>
  );
}
