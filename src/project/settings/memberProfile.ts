import * as api from "../../api";
import { getApiErrorMessage } from "../../api/errorMessages";
import {
  memberConfigFromDraft,
  type MemberConfigDraft,
} from "../../components/memberConfig/memberConfigDraft";

export interface MemberProfileEdit {
  trimmedName: string;
  config: api.ProjectMemberConfig | null;
  nameChanged: boolean;
  configChanged: boolean;
  canSave: boolean;
}

/** Compares an edited name and config draft against the stored member. */
export function memberProfileEdit(
  member: api.ProjectMemberFull,
  name: string,
  draft: MemberConfigDraft,
): MemberProfileEdit {
  const trimmedName = name.trim();
  const config = memberConfigFromDraft(draft);
  const nameChanged = trimmedName !== member.name;
  const configChanged =
    config !== null &&
    (config.size !== member.config?.size || config.paymentMethod !== member.config?.paymentMethod);
  return {
    trimmedName,
    config,
    nameChanged,
    configChanged,
    canSave: trimmedName.length > 0 && config !== null && (nameChanged || configChanged),
  };
}

/**
 * Saves the name and then the config. These are separate requests, so a config failure after the
 * rename is reported as a partial save (`nameSaved`) so callers can refresh the visible name.
 */
export async function saveMemberProfile(
  projectId: string,
  memberId: number,
  edit: MemberProfileEdit,
): Promise<{ ok: true } | { ok: false; nameSaved: boolean; message: string }> {
  let nameSaved = false;
  try {
    if (edit.nameChanged) {
      await api.patchMember(projectId, memberId, { name: edit.trimmedName });
      nameSaved = true;
    }
    if (edit.configChanged && edit.config) {
      await api.putMemberConfig(projectId, memberId, edit.config);
    }
    return { ok: true };
  } catch (error) {
    const message = getApiErrorMessage(error);
    return {
      ok: false,
      nameSaved,
      message: nameSaved
        ? `Member name updated, but the remaining profile details were not saved. ${message}`
        : message,
    };
  }
}
