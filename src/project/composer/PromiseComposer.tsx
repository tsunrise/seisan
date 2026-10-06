import AddIcon from "@mui/icons-material/Add";
import { Box, Button, MenuItem, Stack, TextField } from "@mui/material";
import type { FormEvent } from "react";
import { useState } from "react";

import type * as api from "../../api";
import { getApiErrorMessage } from "../../api/errorMessages";
import { InlineAlert } from "../../components/InlineAlert";
import { LinkedBlockList, LinkedBlockVerb } from "../../components/LinkedBlockForm";
import { MoneyTable } from "../../components/MoneyTable";
import { PanelFrame } from "../../components/PanelFrame";
import { activeMembers, deriveDelta, formatCentsInput, parseCents } from "../../domain";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import type { RecordComposerProps } from "./types";

/** Promise form: `[debtor] should pay [creditor] [amount] for [reason]`. */
export function PromiseComposer({
  project,
  currentMember,
  initialDescription,
  title,
  backTo,
  submitLabel,
  submittingLabel,
  onSubmit,
  onBack,
  footer,
}: RecordComposerProps<"promise">) {
  const { showError } = useAppSnackbar();
  const members = activeMembers(project.members);
  const [debtorMemberId, setDebtorMemberId] = useState(
    initialDescription?.debtorMemberId ?? currentMember.id,
  );
  const [creditorMemberId, setCreditorMemberId] = useState(
    initialDescription?.creditorMemberId ??
      members.find((member) => member.id !== currentMember.id)?.id ??
      currentMember.id,
  );
  const [amount, setAmount] = useState(
    initialDescription ? formatCentsInput(initialDescription.amount) : "",
  );
  const [reason, setReason] = useState(initialDescription?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const cents = parseCents(amount);
  const trimmedReason = reason.trim();
  const description: api.WritableRecordDescription = {
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
    setSubmitting(true);
    try {
      await onSubmit({ description, delta });
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PanelFrame title={title} backTo={backTo} onBack={onBack}>
      <Stack component="form" spacing={2} onSubmit={submit}>
        <LinkedBlockList connector="for">
          <Stack key="promise" spacing={1.1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Box sx={{ flex: "1 1 auto", minWidth: 0 }}>
                <MemberSelect
                  label="Debtor"
                  members={members}
                  value={debtorMemberId}
                  onChange={setDebtorMemberId}
                />
              </Box>
              <LinkedBlockVerb>should pay</LinkedBlockVerb>
            </Stack>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(88px, 0.62fr)",
                columnGap: 0.75,
                alignItems: "center",
              }}
            >
              <MemberSelect
                label="Creditor"
                members={members}
                value={creditorMemberId}
                onChange={setCreditorMemberId}
              />
              <TextField
                label="Amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="12.34"
                required
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>
          </Stack>
          <TextField
            key="reason"
            fullWidth
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </LinkedBlockList>
        <MoneyTable title="Preview" project={project} map={delta} />
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <Button type="submit" variant="contained" startIcon={<AddIcon />} disabled={submitting}>
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </Stack>
      {footer}
    </PanelFrame>
  );
}

function MemberSelect({
  label,
  members,
  value,
  onChange,
}: {
  label: string;
  members: api.ProjectMember[];
  value: number;
  onChange: (memberId: number) => void;
}) {
  return (
    <TextField
      select
      fullWidth
      label={label}
      value={String(value)}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {members.map((member) => (
        <MenuItem key={member.id} value={String(member.id)}>
          {member.name}
        </MenuItem>
      ))}
    </TextField>
  );
}
