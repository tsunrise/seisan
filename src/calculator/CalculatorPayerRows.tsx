import { Box, InputAdornment, TextField } from "@mui/material";

import {
  LinkedBlockList,
  LinkedBlockRemoveButton,
  LinkedBlockVerb,
} from "../components/LinkedBlockForm";
import {
  MAX_CALCULATOR_MEMBER_NAME_LENGTH,
  payerIssueMessage,
  type CalculatorDraft,
  type CalculatorIssue,
} from "./groupExpenseCalculator";

/** "Who paid?" rows: `[name] paid [$ amount]`. Names resolve to members on blur. */
export function CalculatorPayerRows({
  draft,
  issues,
  onChange,
  onCommitName,
  onRemove,
}: {
  draft: CalculatorDraft;
  issues: CalculatorIssue[];
  onChange: (key: number, patch: { name?: string; amount?: string }) => void;
  onCommitName: (key: number) => void;
  onRemove: (key: number) => void;
}) {
  return (
    <LinkedBlockList>
      {draft.payers.map((payer) => {
        const nameIssue = payerIssueMessage(issues, payer.key, "payerName");
        const amountIssue = payerIssueMessage(issues, payer.key, "payerAmount");
        return (
          <Box
            key={payer.key}
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto minmax(88px, 0.62fr) 32px",
              columnGap: 0.75,
              alignItems: "center",
            }}
          >
            <TextField
              label="Member name"
              value={payer.name}
              error={Boolean(nameIssue)}
              helperText={nameIssue}
              onChange={(event) => onChange(payer.key, { name: event.target.value })}
              onBlur={() => onCommitName(payer.key)}
              slotProps={{
                htmlInput: { maxLength: MAX_CALCULATOR_MEMBER_NAME_LENGTH + 1 },
              }}
            />
            <LinkedBlockVerb>paid</LinkedBlockVerb>
            <TextField
              label="Amount"
              inputMode="decimal"
              value={payer.amount}
              error={Boolean(amountIssue)}
              helperText={amountIssue}
              onChange={(event) => onChange(payer.key, { amount: event.target.value })}
              slotProps={{
                input: {
                  startAdornment: <InputAdornment position="start">$</InputAdornment>,
                },
              }}
            />
            <LinkedBlockRemoveButton
              label={`Remove payer row ${payer.name || payer.key}`}
              onClick={() => onRemove(payer.key)}
            />
          </Box>
        );
      })}
    </LinkedBlockList>
  );
}
