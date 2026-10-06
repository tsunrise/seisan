import { Checkbox, FormControlLabel, Stack, TextField, Typography } from "@mui/material";

import { representedGroupCopy, type MemberConfigDraft } from "./memberConfigDraft";

type RepresentedGroupDraft = Pick<MemberConfigDraft, "representsMultiplePeople" | "size">;

export function RepresentedGroupFields({
  draft,
  onChange,
  isSelf,
  disabled = false,
}: {
  draft: RepresentedGroupDraft;
  onChange: (draft: RepresentedGroupDraft) => void;
  isSelf: boolean;
  disabled?: boolean;
}) {
  const copy = representedGroupCopy(isSelf);

  return (
    <>
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
        label={copy.checkboxLabel}
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
            label={copy.sizeLabel}
            type="number"
            value={draft.size}
            onChange={(event) => onChange({ ...draft, size: event.target.value })}
            error={!Number.isSafeInteger(Number(draft.size)) || Number(draft.size) < 2}
            disabled={disabled}
            slotProps={{ htmlInput: { min: 2, max: Number.MAX_SAFE_INTEGER, step: 1 } }}
          />
          <Typography color="text.secondary" sx={{ fontSize: 13, lineHeight: 1.45 }}>
            {copy.helperText}
          </Typography>
        </Stack>
      ) : null}
    </>
  );
}
