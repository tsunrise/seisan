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
import { type ReactNode, useState } from "react";
import { Link, useNavigate } from "react-router";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { MoneyTable } from "../components/MoneyTable";
import { PanelFrame } from "../components/PanelFrame";
import { panelFrameSx } from "../components/styles";
import {
  formatRecordDetailTimestamp,
  memberName,
  negateMoneyMap,
  recordDetailTitle,
  recordSubtitle,
} from "../domain";
import { useAppSnackbar } from "../hooks/useAppSnackbar";

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
  const { showError, showSuccess } = useAppSnackbar();
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const [reverting, setReverting] = useState(false);
  const canRevert =
    canPost && record.description.type !== "revert" && record.reverted === undefined;
  const isRevertedOriginal = record.reverted !== undefined;
  const revertedTextSx = isRevertedOriginal
    ? {
        color: "text.secondary",
        textDecoration: "line-through",
        textDecorationThickness: "1.5px",
      }
    : {};

  async function revert() {
    if (reverting) {
      return;
    }
    setReverting(true);
    try {
      await api.appendRecord(project.id, {
        description: { type: "revert", id: record.id },
        delta: negateMoneyMap(record.delta),
      });
      showSuccess("Record reverted.");
      setConfirmingRevert(false);
      onPosted();
      navigate(`/project/${project.id}`);
    } catch (error) {
      showError(getApiErrorMessage(error));
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
              sx={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.2, ...revertedTextSx }}
            >
              {record.description.type === "revert" ? (
                <>
                  Reverted{" "}
                  <RecordDetailLink projectId={project.id} recordId={record.description.id}>
                    #{record.description.id}
                  </RecordDetailLink>
                </>
              ) : (
                recordDetailTitle(record, project.members)
              )}
            </Typography>
            <Typography color="text.secondary">
              {recordSubtitle(record, project.members)}
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              {formatRecordDetailTimestamp(record.createdAt)}
            </Typography>
            {record.reverted ? (
              <Typography color="text.secondary" sx={{ fontSize: 13, fontWeight: 650 }}>
                Reverted by {memberName(project.members, record.reverted.authorMemberId)} (
                <RecordDetailLink projectId={project.id} recordId={record.reverted.recordId}>
                  #{record.reverted.recordId}
                </RecordDetailLink>
                ) at {formatRecordDetailTimestamp(record.reverted.createdAt)}
              </Typography>
            ) : null}
          </Stack>
          {record.description.type !== "revert" ? (
            <>
              <Divider />
              <MoneyTable
                title="Balance change"
                project={project}
                map={record.delta}
                muted={isRevertedOriginal}
              />
            </>
          ) : null}
          {record.description.type === "expense" ? (
            <>
              <Divider />
              <MoneyTable
                title="Paid"
                project={project}
                map={record.description.paid}
                amountColorMode="plain"
              />
              <MoneyTable
                title="Liability"
                project={project}
                map={record.description.liability}
                amountColorMode="plain"
              />
            </>
          ) : null}
          {canRevert ? (
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

function RecordDetailLink({
  projectId,
  recordId,
  children,
}: {
  projectId: string;
  recordId: number;
  children: ReactNode;
}) {
  return (
    <Typography
      component={Link}
      to={`/project/${projectId}/records/${recordId}`}
      sx={{
        color: "primary.main",
        font: "inherit",
        fontWeight: "inherit",
        textDecoration: "none",
        "&:hover": {
          textDecoration: "underline",
        },
        "&:focus-visible": {
          outline: "2px solid currentColor",
          outlineOffset: 2,
        },
      }}
    >
      {children}
    </Typography>
  );
}
