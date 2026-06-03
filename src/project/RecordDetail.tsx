import UndoIcon from "@mui/icons-material/Undo";
import { Button, Paper, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { MoneyTable } from "../components/MoneyTable";
import { PanelFrame } from "../components/PanelFrame";
import { panelFrameSx } from "../components/styles";
import { formatCents, memberName, negateMoneyMap, recordSubtitle, recordTitle } from "../domain";

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

  async function revert() {
    setError(null);
    try {
      await api.appendRecord(project.id, {
        description: { type: "revert", id: record.id },
        delta: negateMoneyMap(record.delta),
      });
      onPosted();
      navigate(`/project/${project.id}`);
    } catch {
      setError("Could not revert this record.");
    }
  }

  return (
    <PanelFrame title="Record detail" backTo={`/project/${project.id}`}>
      <Paper component="article" square sx={panelFrameSx}>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="h2">{recordTitle(record, project.members)}</Typography>
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
            <Button variant="outlined" startIcon={<UndoIcon />} onClick={() => void revert()}>
              Revert
            </Button>
          ) : null}
        </Stack>
      </Paper>
    </PanelFrame>
  );
}
