import { Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";

import type * as api from "../../api";
import { LinkedBlockList, LinkedBlockVerb } from "../../components/LinkedBlockForm";
import { memberSize } from "../../domain";
import { ledgerColors } from "../../theme";
import type { SplitMode } from "../../types";
import { MemberSplitRow } from "./MemberSplitRow";

/** "This expense should be paid by" block: split-mode toggle plus one row per active member. */
export function ExpenseSplitSection({
  members,
  splitMode,
  selectedIds,
  ratios,
  customAmounts,
  liability,
  onSplitMode,
  onSelected,
  onRatio,
  onCustomAmount,
}: {
  members: api.ProjectMemberFull[];
  splitMode: SplitMode;
  selectedIds: number[];
  ratios: Record<number, string>;
  customAmounts: Record<number, string>;
  liability: api.MoneyByMemberId;
  onSplitMode: (splitMode: SplitMode) => void;
  onSelected: (memberId: number, selected: boolean) => void;
  onRatio: (memberId: number, value: string) => void;
  onCustomAmount: (memberId: number, value: string) => void;
}) {
  return (
    <Stack spacing={1}>
      <LinkedBlockVerb>This expense should be paid by</LinkedBlockVerb>
      <LinkedBlockList>
        <Stack key="sharing" spacing={1.25}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={splitMode}
            onChange={(_, next: SplitMode | null) => {
              if (next) {
                onSplitMode(next);
              }
            }}
            sx={{
              width: "100%",
              "& .MuiToggleButton-root": {
                flex: "1 1 0",
                minWidth: 0,
                minHeight: 36,
                px: 1.5,
              },
            }}
          >
            <ToggleButton value="equal">Equal</ToggleButton>
            <ToggleButton value="ratio">Ratio</ToggleButton>
            <ToggleButton value="custom">Custom</ToggleButton>
          </ToggleButtonGroup>
          <Stack spacing={0.25}>
            {members.map((member) => (
              <MemberSplitRow
                key={member.id}
                member={member}
                selected={selectedIds.includes(member.id)}
                splitMode={splitMode}
                value={
                  splitMode === "ratio"
                    ? (ratios[member.id] ?? String(memberSize(member)))
                    : (customAmounts[member.id] ?? "")
                }
                amount={liability[String(member.id)] ?? 0}
                onSelected={(selected) => onSelected(member.id, selected)}
                onValue={(value) =>
                  splitMode === "ratio"
                    ? onRatio(member.id, value)
                    : onCustomAmount(member.id, value)
                }
              />
            ))}
          </Stack>
          <Typography sx={{ color: ledgerColors.muted, fontSize: 12.5, lineHeight: 1.4 }}>
            You can add additional members in project settings or edit this post later when more
            members join.
          </Typography>
        </Stack>
      </LinkedBlockList>
    </Stack>
  );
}
