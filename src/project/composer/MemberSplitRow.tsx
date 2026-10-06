import { Checkbox, Stack, TextField } from "@mui/material";

import type * as api from "../../api";
import { Amount } from "../../components/Amount";
import { MemberNameWithRepresentation } from "../../components/MemberNameWithRepresentation";
import type { SplitMode } from "../../types";

export function MemberSplitRow({
  member,
  selected,
  splitMode,
  value,
  amount,
  onSelected,
  onValue,
}: {
  member: api.ProjectMemberFull;
  selected: boolean;
  splitMode: SplitMode;
  value: string;
  amount: number;
  onSelected: (selected: boolean) => void;
  onValue: (value: string) => void;
}) {
  return (
    <Stack
      component="label"
      direction="row"
      sx={{
        alignItems: "center",
        cursor: "pointer",
        gap: 1.25,
        minHeight: 48,
        py: 0.75,
      }}
    >
      <Checkbox
        checked={selected}
        onChange={(event) => onSelected(event.target.checked)}
        sx={{ p: 0.5 }}
      />
      <Stack sx={{ minWidth: 0, flex: "1 1 auto" }}>
        <MemberNameWithRepresentation
          member={member}
          nameSx={{
            minWidth: 0,
            color: selected ? "text.primary" : "text.secondary",
            fontWeight: selected ? 500 : 450,
          }}
        />
      </Stack>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "flex-end", gap: 1.25, minWidth: 0 }}
      >
        <Amount amount={amount} />
        {splitMode !== "equal" && selected ? (
          <TextField
            value={value}
            inputMode="decimal"
            onChange={(event) => onValue(event.target.value)}
            placeholder={splitMode === "ratio" ? String(member.config?.size ?? 1) : "0.00"}
            sx={{ width: 76 }}
          />
        ) : null}
      </Stack>
    </Stack>
  );
}
