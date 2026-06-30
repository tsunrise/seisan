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

export function PromiseComposer({
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
  const [debtorMemberId, setDebtorMemberId] = useState(currentMember.id);
  const [creditorMemberId, setCreditorMemberId] = useState(
    members.find((member) => member.id !== currentMember.id)?.id ?? currentMember.id,
  );
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cents = parseCents(amount);
  const trimmedReason = reason.trim();
  const description: api.RecordDescription = {
    type: "promise",
    debtorMemberId,
    creditorMemberId,
    amount: cents ?? 0,
    ...(trimmedReason ? { reason: trimmedReason } : {}),
  };
  const delta =
    cents === null || debtorMemberId === creditorMemberId ? {} : deriveDelta(description);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (cents === null || cents <= 0 || debtorMemberId === creditorMemberId) {
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
    <PanelFrame title="New promise" backTo={`/project/${project.id}/records/new`} onBack={onBack}>
      <Stack component="form" spacing={2} onSubmit={submit}>
        <RecordSentenceRow>
          <RecordSentenceField minWidth={148}>
            <TextField
              select
              label="Debtor"
              value={String(debtorMemberId)}
              onChange={(event) => setDebtorMemberId(Number(event.target.value))}
            >
              {members.map((member) => (
                <MenuItem key={member.id} value={String(member.id)}>
                  {member.name}
                </MenuItem>
              ))}
            </TextField>
          </RecordSentenceField>
          <RecordFormBridge>should pay</RecordFormBridge>
          <RecordSentenceField minWidth={148}>
            <TextField
              select
              label="Creditor"
              value={String(creditorMemberId)}
              onChange={(event) => setCreditorMemberId(Number(event.target.value))}
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
          <RecordFormBridge>for</RecordFormBridge>
          <RecordSentenceField grow minWidth={180}>
            <TextField
              label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
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
