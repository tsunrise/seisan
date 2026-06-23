import AddIcon from "@mui/icons-material/Add";
import { Button, MenuItem, Stack, TextField } from "@mui/material";
import type { FormEvent } from "react";
import { useState } from "react";
import { useNavigate } from "react-router";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { MoneyTable } from "../components/MoneyTable";
import { PanelFrame } from "../components/PanelFrame";
import { activeMembers, deriveDelta, parseCents } from "../domain";

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
      onPosted();
      navigate(`/project/${project.id}`);
    } catch {
      setError("Could not post this promise.");
    }
  }

  return (
    <PanelFrame title="New promise" backTo={`/project/${project.id}/records/new`} onBack={onBack}>
      <Stack component="form" spacing={2} onSubmit={submit}>
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
        <TextField
          label="Amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="12.34"
          required
        />
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <MoneyTable title="Preview" project={project} map={delta} />
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <Button type="submit" variant="contained" startIcon={<AddIcon />}>
          Post
        </Button>
      </Stack>
    </PanelFrame>
  );
}
