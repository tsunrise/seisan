import UndoIcon from "@mui/icons-material/Undo";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { MoneyTable } from "../components/MoneyTable";
import { PanelFrame } from "../components/PanelFrame";
import { panelFrameSx } from "../components/styles";
import { formatCents, memberName, negateMoneyMap, recordSubtitle, recordTitle } from "../domain";

function memberNames(members: api.ProjectMember[], memberIds: number[]): string {
  if (memberIds.length === 0) {
    return "Someone";
  }
  if (memberIds.length === 1) {
    return memberName(members, memberIds[0]);
  }
  if (memberIds.length === 2) {
    return `${memberName(members, memberIds[0])} and ${memberName(members, memberIds[1])}`;
  }
  return `${memberIds
    .slice(0, -1)
    .map((memberId) => memberName(members, memberId))
    .join(", ")}, and ${memberName(members, memberIds[memberIds.length - 1])}`;
}

function recordDetailTitle(record: api.ProjectRecord, members: api.ProjectMember[]): string {
  if (record.description.type === "expense") {
    const payerIds = Object.keys(record.description.paid).map(Number);
    const totalPaid = Object.values(record.description.paid).reduce(
      (total, amount) => total + amount,
      0,
    );
    return `${memberNames(members, payerIds)} paid ${formatCents(totalPaid)} for ${
      record.description.name
    }`;
  }

  if (record.description.type === "transfer") {
    return `${memberName(members, record.description.from)} transferred ${memberName(
      members,
      record.description.to,
    )} ${formatCents(record.description.amount)}`;
  }

  return recordTitle(record, members);
}

export function RecordDetail({
  project,
  record,
  canPost,
  onPosted,
}: {
  project: api.Project;
  record: api.ProjectRecord;
  canPost: boolean;
  onPosted: () => void;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const [reverting, setReverting] = useState(false);

  async function revert() {
    if (reverting) {
      return;
    }
    setReverting(true);
    setError(null);
    try {
      await api.appendRecord(project.id, {
        description: { type: "revert", id: record.id },
        delta: negateMoneyMap(record.delta),
      });
      setConfirmingRevert(false);
      onPosted();
      navigate(`/project/${project.id}`);
    } catch {
      setError("Could not revert this record.");
    } finally {
      setReverting(false);
    }
  }

  return (
    <PanelFrame title="Record detail" backTo={`/project/${project.id}`}>
      <Paper component="article" square sx={panelFrameSx}>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="h2">{recordDetailTitle(record, project.members)}</Typography>
            <Typography color="text.secondary">
              {recordSubtitle(record, project.members)}
            </Typography>
          </Stack>
          <MoneyTable title="Balance change" project={project} map={record.delta} />
          {record.description.type === "expense" ? (
            <>
              <MoneyTable title="Paid" project={project} map={record.description.paid} />
              <MoneyTable title="Liability" project={project} map={record.description.liability} />
            </>
          ) : null}
          {record.description.type === "transfer" ? (
            <Typography>
              {memberName(project.members, record.description.from)} paid{" "}
              {memberName(project.members, record.description.to)}{" "}
              {formatCents(record.description.amount)}.
            </Typography>
          ) : null}
          {record.description.type === "revert" ? (
            <Typography>Reverts #{record.description.id}.</Typography>
          ) : null}
          {error ? <InlineAlert>{error}</InlineAlert> : null}
          {canPost && record.description.type !== "revert" ? (
            <Button
              variant="outlined"
              startIcon={<UndoIcon />}
              disabled={reverting}
              onClick={() => setConfirmingRevert(true)}
            >
              Revert
            </Button>
          ) : null}
        </Stack>
      </Paper>
      <Dialog
        open={confirmingRevert}
        onClose={() => {
          if (!reverting) {
            setConfirmingRevert(false);
          }
        }}
        fullWidth
      >
        <DialogTitle>Revert record?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will post a new record that reverses #{record.id}. The original record stays in the
            timeline.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={reverting} onClick={() => setConfirmingRevert(false)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={reverting}
            onClick={() => void revert()}
          >
            Revert
          </Button>
        </DialogActions>
      </Dialog>
    </PanelFrame>
  );
}
