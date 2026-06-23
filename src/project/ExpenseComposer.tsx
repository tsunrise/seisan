import AddIcon from "@mui/icons-material/Add";
import {
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { MoneyTable } from "../components/MoneyTable";
import { PanelFrame } from "../components/PanelFrame";
import { activeMembers, allocateEqual, allocateRatio, deriveDelta, parseCents } from "../domain";
import type { SplitMode } from "../types";
import { MemberSplitRow } from "./MemberSplitRow";
import { RecordFormBridge } from "./RecordFormBridge";

export function ExpenseComposer({
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
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(currentMember.id);
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [selectedIds, setSelectedIds] = useState(() => members.map((member) => member.id));
  const [ratios, setRatios] = useState<Record<number, string>>({});
  const [customAmounts, setCustomAmounts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const total = parseCents(amount);
  const liability = useMemo(() => {
    if (total === null) {
      return {};
    }
    if (splitMode === "equal") {
      return allocateEqual(total, selectedIds);
    }
    if (splitMode === "ratio") {
      return allocateRatio(
        total,
        selectedIds.map((memberId) => ({
          memberId,
          ratio: Number(ratios[memberId] || "1"),
        })),
      );
    }
    const custom: api.MoneyByMemberId = {};
    for (const memberId of selectedIds) {
      const parsed = parseCents(customAmounts[memberId] ?? "");
      if (parsed !== null) {
        custom[String(memberId)] = parsed;
      }
    }
    return custom;
  }, [customAmounts, ratios, selectedIds, splitMode, total]);
  const paid = total === null ? {} : { [String(paidBy)]: total };
  const description: api.RecordDescription = {
    type: "expense",
    name: name || "Expense",
    paid,
    liability,
  };
  const delta = deriveDelta(description);
  const customTotal = Object.values(liability).reduce((sum, value) => sum + value, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (total === null || total <= 0 || selectedIds.length === 0 || customTotal !== total) {
      setError("Check the amount and split.");
      return;
    }
    try {
      await api.appendRecord(project.id, { description, delta });
      onPosted();
      navigate(`/project/${project.id}`);
    } catch {
      setError("Could not post this expense.");
    }
  }

  return (
    <PanelFrame
      title="New group spend"
      backTo={`/project/${project.id}/records/new`}
      onBack={onBack}
    >
      <Stack component="form" spacing={2} onSubmit={submit}>
        <Box
          sx={{
            display: "grid",
            gap: { xs: 0.75, sm: 1 },
            gridTemplateColumns: "1fr",
            alignItems: "center",
          }}
        >
          <TextField
            select
            label="Payer"
            value={String(paidBy)}
            onChange={(event) => setPaidBy(Number(event.target.value))}
          >
            {members.map((member) => (
              <MenuItem key={member.id} value={String(member.id)}>
                {member.name}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: { xs: 0.75, sm: 1 },
            gridTemplateColumns: { xs: "1fr", sm: "auto minmax(0, 1fr)" },
            alignItems: "center",
          }}
        >
          <RecordFormBridge>paid</RecordFormBridge>
          <TextField
            label="Amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="12.34"
            required
          />
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: { xs: 0.75, sm: 1 },
            gridTemplateColumns: { xs: "1fr", sm: "auto minmax(0, 1fr)" },
            alignItems: "center",
          }}
        >
          <RecordFormBridge>for</RecordFormBridge>
          <TextField
            label="Expense"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Box>
        <Stack spacing={1.25}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            sx={{ alignItems: { xs: "stretch", sm: "center" }, gap: 1 }}
          >
            <Typography variant="h3" sx={{ flex: "1 1 auto" }}>
              Shared with
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              value={splitMode}
              onChange={(_, next: SplitMode | null) => {
                if (next) {
                  setSplitMode(next);
                }
              }}
              sx={{
                flex: { xs: "1 1 auto", sm: "0 0 240px" },
                "& .MuiToggleButton-root": {
                  minHeight: 36,
                  px: 1.5,
                },
              }}
            >
              <ToggleButton value="equal">Equal</ToggleButton>
              <ToggleButton value="ratio">Ratio</ToggleButton>
              <ToggleButton value="custom">Custom</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <Stack spacing={0.25}>
            {members.map((member) => (
              <MemberSplitRow
                key={member.id}
                member={member}
                selected={selectedIds.includes(member.id)}
                splitMode={splitMode}
                value={
                  splitMode === "ratio"
                    ? (ratios[member.id] ?? "1")
                    : (customAmounts[member.id] ?? "")
                }
                amount={liability[String(member.id)] ?? 0}
                onSelected={(selected) =>
                  setSelectedIds((ids) =>
                    selected
                      ? [...ids, member.id].sort((left, right) => left - right)
                      : ids.filter((id) => id !== member.id),
                  )
                }
                onValue={(value) =>
                  splitMode === "ratio"
                    ? setRatios((next) => ({ ...next, [member.id]: value }))
                    : setCustomAmounts((next) => ({ ...next, [member.id]: value }))
                }
              />
            ))}
          </Stack>
        </Stack>
        <MoneyTable title="Preview" project={project} map={delta} />
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <Button type="submit" variant="contained" startIcon={<AddIcon />}>
          Post
        </Button>
      </Stack>
    </PanelFrame>
  );
}
