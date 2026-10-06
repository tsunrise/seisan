import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { Button, Divider } from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router";

import * as api from "../../api";
import { getApiErrorMessage } from "../../api/errorMessages";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { InlineAlert } from "../../components/InlineAlert";
import { PanelFrame } from "../../components/PanelFrame";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import { RecordComposer } from "../composer/RecordComposer";
import { recordComposerNouns, type RecordComposerSubmission } from "../composer/types";
import { projectPaths } from "../paths";
import { recordReferencesDeletedMember, writableRecordDescription } from "./recordEditing";

/**
 * Edits a live record with its type's composer, prefilled from the stored description. Deletion
 * lives in the composer footer and returns to the record's tombstone detail.
 */
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
  const detailPath = projectPaths.record(project.id, record.id);
  const description = writableRecordDescription(record);

  if (!currentMember) {
    return (
      <EditUnavailable backTo={detailPath} message="Join this project before editing records." />
    );
  }
  if (!description) {
    return <EditUnavailable backTo={detailPath} message="This record cannot be edited." />;
  }
  if (recordReferencesDeletedMember(record, project.members)) {
    return (
      <EditUnavailable
        backTo={detailPath}
        message="Records involving deleted project members cannot be edited or deleted."
      />
    );
  }

  async function saveRecord(input: RecordComposerSubmission) {
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

  return (
    <>
      <RecordComposer
        key={`${record.id}:${record.updatedAt ?? record.createdAt}`}
        kind={description.type}
        initialDescription={description}
        project={project}
        currentMember={currentMember}
        categories={categories}
        title={`Edit ${recordComposerNouns[description.type]}`}
        backTo={detailPath}
        submitLabel="Save changes"
        submittingLabel="Saving…"
        onSubmit={saveRecord}
        footer={
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
        }
      />
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete post?"
        description="This reverses the post's balance changes and keeps a deleted history entry."
        confirmLabel={deleting ? "Deleting…" : "Delete post"}
        busy={deleting}
        onConfirm={() => void deleteRecord()}
        onClose={() => setConfirmingDelete(false)}
      />
    </>
  );
}

function EditUnavailable({ backTo, message }: { backTo: string; message: string }) {
  return (
    <PanelFrame title="Edit record" backTo={backTo}>
      <InlineAlert>{message}</InlineAlert>
    </PanelFrame>
  );
}
