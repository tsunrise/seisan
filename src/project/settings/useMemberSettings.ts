import { useState } from "react";

import * as api from "../../api";
import { getApiErrorMessage } from "../../api/errorMessages";
import {
  memberConfigDraft,
  memberConfigDraftIsValid,
  memberConfigFromDraft,
} from "../../components/memberConfig/memberConfigDraft";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import { memberProfileEdit, saveMemberProfile } from "./memberProfile";

export type MemberEditor = ReturnType<typeof useMemberEditor>;
export type NewMemberForm = ReturnType<typeof useNewMemberForm>;

/** State for the edit-member dialog. `member` is null while the dialog is closed. */
export function useMemberEditor(projectId: string, onReload: () => void) {
  const { showError, showSuccess } = useAppSnackbar();
  const [member, setMember] = useState<api.ProjectMemberFull | null>(null);
  const [name, setName] = useState("");
  const [config, setConfig] = useState(() => memberConfigDraft());
  const [saving, setSaving] = useState(false);
  const edit = member ? memberProfileEdit(member, name, config) : null;

  function reset() {
    setMember(null);
    setName("");
    setConfig(memberConfigDraft());
  }

  return {
    member,
    name,
    setName,
    config,
    setConfig,
    saving,
    canSave: edit?.canSave ?? false,
    open(next: api.ProjectMemberFull) {
      setMember(next);
      setName(next.name);
      setConfig(memberConfigDraft(next.config));
    },
    close() {
      if (!saving) {
        reset();
      }
    },
    async save() {
      if (!member || !edit?.canSave || saving) {
        return;
      }
      setSaving(true);
      const result = await saveMemberProfile(projectId, member.id, edit);
      if (result.ok) {
        reset();
        onReload();
        showSuccess("Member updated.");
      } else {
        if (result.nameSaved) {
          setMember({ ...member, name: edit.trimmedName });
          onReload();
        }
        showError(result.message);
      }
      setSaving(false);
    },
  };
}

/**
 * State for adding a placeholder member. The represented size is saved with a follow-up config
 * request using the new member's ID; the transfer method is left for the member to fill in.
 */
export function useNewMemberForm(projectId: string, onReload: () => void) {
  const { showError, showSuccess } = useAppSnackbar();
  const [name, setName] = useState("");
  const [config, setConfig] = useState(() => memberConfigDraft());
  const [adding, setAdding] = useState(false);
  const canAdd =
    name.trim().length > 0 &&
    memberConfigDraftIsValid(config, { includePaymentMethod: false }) &&
    !adding;

  function reset() {
    setName("");
    setConfig(memberConfigDraft());
  }

  return {
    name,
    setName,
    config,
    setConfig,
    adding,
    canAdd,
    async add() {
      const memberConfig = memberConfigFromDraft(config, { includePaymentMethod: false });
      if (!name.trim() || !memberConfig || adding) {
        return;
      }
      setAdding(true);
      try {
        const created = await api.createMember(projectId, name.trim());
        try {
          if (Object.keys(memberConfig).length > 0) {
            await api.putMemberConfig(projectId, created.member.id, memberConfig);
          }
        } catch (error) {
          reset();
          onReload();
          showError(
            `Member added, but represented size was not saved. ${getApiErrorMessage(error)}`,
          );
          return;
        }
        reset();
        onReload();
        showSuccess("Member added.");
      } catch (error) {
        showError(getApiErrorMessage(error));
      } finally {
        setAdding(false);
      }
    },
  };
}
