import UndoIcon from "@mui/icons-material/Undo";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
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
import {
  formatRecordDetailTimestamp,
  negateMoneyMap,
  recordDetailTitle,
  recordSubtitle,
} from "../domain";

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
      <Paper component="article" sx={{ ...panelFrameSx, boxShadow: "none" }}>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography color="text.secondary" sx={{ fontWeight: 650 }}>
              #{record.id}
            </Typography>
            <Typography
              component="h2"
              sx={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.2 }}
            >
              {recordDetailTitle(record, project.members)}
            </Typography>
            <Typography color="text.secondary">
              {recordSubtitle(record, project.members)}
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              {formatRecordDetailTimestamp(record.createdAt)}
            </Typography>
          </Stack>
          <Divider />
          <MoneyTable title="Balance change" project={project} map={record.delta} />
          {record.description.type === "expense" ? (
            <>
              <Divider />
              <MoneyTable title="Paid" project={project} map={record.description.paid} />
              <MoneyTable title="Liability" project={project} map={record.description.liability} />
            </>
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
