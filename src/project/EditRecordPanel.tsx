import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
} from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { InlineAlert } from "../components/InlineAlert";
import { PanelFrame } from "../components/PanelFrame";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { ExpenseComposer } from "./ExpenseComposer";
import { PromiseComposer } from "./PromiseComposer";
import { recordReferencesDeletedMember, writableRecordDescription } from "./recordEditing";
import { TransferComposer } from "./TransferComposer";

export function EditRecordPanel({
  project,
  currentMember,
  record,
  categories,
  onChanged,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
  record: api.ProjectRecord;
  categories: api.Category[];
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const { showError, showSuccess } = useAppSnackbar();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const detailPath = `/project/${project.id}/records/${record.id}`;
  const description = writableRecordDescription(record);

  if (!currentMember) {
    return (
      <PanelFrame title="Edit record" backTo={detailPath}>
        <InlineAlert>Join this project before editing records.</InlineAlert>
      </PanelFrame>
    );
  }

  if (!description) {
    return (
      <PanelFrame title="Edit record" backTo={detailPath}>
        <InlineAlert>This record cannot be edited.</InlineAlert>
      </PanelFrame>
    );
  }

  if (recordReferencesDeletedMember(record, project.members)) {
    return (
      <PanelFrame title="Edit record" backTo={detailPath}>
        <InlineAlert>
          Records involving deleted project members cannot be edited or deleted.
        </InlineAlert>
      </PanelFrame>
    );
  }

  async function saveRecord(input: {
    description: api.WritableRecordDescription;
    delta: api.MoneyByMemberId;
  }) {
    setSaving(true);
    try {
      await api.putRecord(project.id, record.id, input);
      showSuccess("Record updated.");
      onChanged();
      navigate(detailPath);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord() {
    setDeleting(true);
    try {
      await api.deleteRecord(project.id, record.id);
      showSuccess("Post deleted.");
      setConfirmingDelete(false);
      onChanged();
      navigate(detailPath);
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  const footer = (
    <>
      <Divider />
      <Button
        type="button"
        color="error"
        variant="text"
        startIcon={<DeleteOutlineIcon />}
        disabled={saving || deleting}
        onClick={() => setConfirmingDelete(true)}
        sx={{ alignSelf: "flex-start", px: 0.5 }}
      >
        Delete post
      </Button>
    </>
  );

  const composer =
    description.type === "expense" ? (
      <ExpenseComposer
        key={`${record.id}:${record.updatedAt ?? record.createdAt}`}
        project={project}
        currentMember={currentMember}
        categories={categories}
        initialDescription={description}
        title="Edit group spend"
        backTo={detailPath}
        submitLabel="Save changes"
        submittingLabel="Saving…"
        onSubmit={saveRecord}
        footer={footer}
      />
    ) : description.type === "transfer" ? (
      <TransferComposer
        key={`${record.id}:${record.updatedAt ?? record.createdAt}`}
        project={project}
        currentMember={currentMember}
        initialDescription={description}
        title="Edit transfer"
        backTo={detailPath}
        submitLabel="Save changes"
        submittingLabel="Saving…"
        onSubmit={saveRecord}
        footer={footer}
      />
    ) : (
      <PromiseComposer
        key={`${record.id}:${record.updatedAt ?? record.createdAt}`}
        project={project}
        currentMember={currentMember}
        initialDescription={description}
        title="Edit promise"
        backTo={detailPath}
        submitLabel="Save changes"
        submittingLabel="Saving…"
        onSubmit={saveRecord}
        footer={footer}
      />
    );

  return (
    <>
      {composer}
      <Dialog
        open={confirmingDelete}
        onClose={() => {
          if (!deleting) {
            setConfirmingDelete(false);
          }
        }}
        fullWidth
      >
        <DialogTitle>Delete post?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This reverses the post&apos;s balance changes and keeps a deleted history entry.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={deleting} onClick={() => setConfirmingDelete(false)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleting}
            onClick={() => void deleteRecord()}
          >
            {deleting ? "Deleting…" : "Delete post"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
