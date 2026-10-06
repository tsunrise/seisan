import { Stack, TextField } from "@mui/material";

import type { MemberConfigDraft } from "./memberConfigDraft";
import { RepresentedGroupFields } from "./RepresentedGroupFields";

export function MemberConfigFields({
  draft,
  onChange,
  isSelf,
  includePaymentMethod = true,
  disabled = false,
}: {
  draft: MemberConfigDraft;
  onChange: (draft: MemberConfigDraft) => void;
  isSelf: boolean;
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
          helperText={
            isSelf
              ? "How other members should transfer money to you."
              : "How other members should transfer money to this member."
          }
          disabled={disabled}
          multiline
          minRows={1}
          maxRows={3}
          slotProps={{ htmlInput: { maxLength: 10_000 } }}
        />
      ) : null}
      <RepresentedGroupFields
        draft={draft}
        onChange={(representedDraft) => onChange({ ...draft, ...representedDraft })}
        isSelf={isSelf}
        disabled={disabled}
      />
    </Stack>
  );
}
