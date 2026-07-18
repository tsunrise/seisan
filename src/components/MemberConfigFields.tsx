import { Checkbox, FormControlLabel, Stack, TextField, Typography } from "@mui/material";

import type { MemberConfigDraft } from "../memberConfig";

export function MemberConfigFields({
  draft,
  onChange,
  includePaymentMethod = true,
  disabled = false,
}: {
  draft: MemberConfigDraft;
  onChange: (draft: MemberConfigDraft) => void;
  includePaymentMethod?: boolean;
  disabled?: boolean;
}) {
  return (
    <Stack spacing={1.5}>
      {includePaymentMethod ? (
        <TextField
          label="Transfer method"
          placeholder="Venmo, Zelle, bank transfer…"
          value={draft.paymentMethod}
          onChange={(event) => onChange({ ...draft, paymentMethod: event.target.value })}
          helperText="How other members should transfer money to you."
          disabled={disabled}
          multiline
          minRows={1}
          maxRows={3}
          slotProps={{ htmlInput: { maxLength: 10_000 } }}
        />
      ) : null}
      <FormControlLabel
        control={
          <Checkbox
            checked={draft.representsMultiplePeople}
            onChange={(event) =>
              onChange({ ...draft, representsMultiplePeople: event.target.checked })
            }
            disabled={disabled}
            sx={{ p: 0.5 }}
          />
        }
        label="I represent multiple people"
        sx={{
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 0.5,
          m: 0,
          "& .MuiFormControlLabel-label": { fontSize: 14, fontWeight: 600 },
        }}
      />
      {draft.representsMultiplePeople ? (
        <Stack spacing={0.75}>
          <TextField
            label="Number of people represented"
            type="number"
            value={draft.size}
            onChange={(event) => onChange({ ...draft, size: event.target.value })}
            error={!Number.isSafeInteger(Number(draft.size)) || Number(draft.size) < 2}
            disabled={disabled}
            slotProps={{ htmlInput: { min: 2, max: Number.MAX_SAFE_INTEGER, step: 1 } }}
          />
          <Typography color="text.secondary" sx={{ fontSize: 13, lineHeight: 1.45 }}>
            Include yourself in this total. The people you represent should not join this project
            independently.
          </Typography>
        </Stack>
      ) : null}
    </Stack>
  );
}
