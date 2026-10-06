import type { ReactNode } from "react";

import type * as api from "../../api";

export type RecordComposerKind = api.WritableRecordDescription["type"];

/** Lowercase record-type noun used in composer titles, such as "New group spend". */
export const recordComposerNouns: Record<RecordComposerKind, string> = {
  expense: "group spend",
  transfer: "transfer",
  promise: "promise",
};

export interface RecordComposerSubmission {
  description: api.WritableRecordDescription;
  delta: api.MoneyByMemberId;
}

/** Props shared by the expense, transfer, and promise composers for both posting and editing. */
export interface RecordComposerProps<Kind extends RecordComposerKind> {
  project: api.Project;
  currentMember: api.ProjectMember;
  /** Prefills the form when editing an existing record of this kind. */
  initialDescription?: Extract<api.WritableRecordDescription, { type: Kind }>;
  title: string;
  backTo: string;
  submitLabel: string;
  submittingLabel: string;
  /** Persists the record. Rejections are reported through the app snackbar. */
  onSubmit: (input: RecordComposerSubmission) => Promise<void>;
  onBack?: () => void;
  footer?: ReactNode;
}
