import { useEffect, useMemo, useState } from "react";

import type { SplitMode } from "../types";
import {
  clearCalculatorDraft,
  loadCalculatorDraft,
  scheduleCalculatorDraftSave,
  type CalculatorDraftStorage,
} from "./calculatorStorage";
import {
  activeCalculatorPayerMemberIds,
  addCalculatorLiabilityMember,
  addCalculatorPayer,
  calculateGroupExpense,
  commitCalculatorPayerName,
  createInitialCalculatorDraft,
  deleteCalculatorLiabilityMember,
  previewCalculatorAllocation,
  removeCalculatorPayer,
  renameCalculatorLiabilityMember,
  setCalculatorMemberSelected,
  setCalculatorSplitMode,
  updateCalculatorCustomAmount,
  updateCalculatorPayer,
  updateCalculatorRatio,
  type CalculatorDraft,
  type CalculatorIssue,
  type CalculatorPlan,
} from "./groupExpenseCalculator";

/** The single open liability-name editor: renaming an existing member or naming a new one. */
export type LiabilityNameEditor =
  | { kind: "member"; memberId: number; value: string; issue: string | null }
  | { kind: "new"; value: string; issue: string | null };

interface InitialCalculatorState {
  draft: CalculatorDraft;
  storage: CalculatorDraftStorage | null;
  storageWarning: boolean;
}

function initialCalculatorState(): InitialCalculatorState {
  try {
    const storage = window.localStorage;
    return { draft: loadCalculatorDraft(storage), storage, storageWarning: false };
  } catch {
    return {
      draft: createInitialCalculatorDraft(),
      storage: null,
      storageWarning: true,
    };
  }
}

/**
 * Calculator page state. The draft persists to local storage after edits; any edit hides the
 * computed plan until the visitor calculates again. Name editors and plans are never persisted.
 */
export function useGroupExpenseCalculator() {
  const [initialState] = useState(initialCalculatorState);
  const [draft, setDraft] = useState(initialState.draft);
  const [issues, setIssues] = useState<CalculatorIssue[]>([]);
  const [plan, setPlan] = useState<CalculatorPlan | null>(null);
  const [storageWarning, setStorageWarning] = useState(initialState.storageWarning);
  const [nameEditor, setNameEditor] = useState<LiabilityNameEditor | null>(null);

  useEffect(() => {
    const storage = initialState.storage;
    if (!storage) {
      return;
    }
    return scheduleCalculatorDraftSave(storage, draft, () => setStorageWarning(true));
  }, [draft, initialState.storage]);

  const payerMemberIds = activeCalculatorPayerMemberIds(draft);
  const selectedMemberIds = useMemo(() => new Set(draft.selectedMemberIds), [draft]);
  const allocationPreview = useMemo(() => previewCalculatorAllocation(draft), [draft]);

  function editDraft(update: CalculatorDraft | ((current: CalculatorDraft) => CalculatorDraft)) {
    setDraft((current) => (typeof update === "function" ? update(current) : update));
    hideResult();
  }

  function hideResult() {
    setPlan(null);
    setIssues([]);
  }

  return {
    draft,
    issues,
    plan,
    storageWarning,
    nameEditor,
    payerMemberIds,
    selectedMemberIds,
    allocationPreview,

    addPayer() {
      editDraft(addCalculatorPayer(draft));
    },
    updatePayer(key: number, patch: { name?: string; amount?: string }) {
      editDraft((current) => updateCalculatorPayer(current, key, patch));
    },
    removePayer(key: number) {
      editDraft((current) => removeCalculatorPayer(current, key));
    },
    /** Resolves a payer's typed name to a member on blur, reporting only that row's issue. */
    commitPayerName(key: number) {
      const committed = commitCalculatorPayerName(draft, key);
      setDraft(committed.draft);
      setPlan(null);
      setIssues((current) => [
        ...current.filter((issue) => !(issue.field === "payerName" && issue.key === key)),
        ...(committed.issue ? [committed.issue] : []),
      ]);
    },

    setSplitMode(splitMode: SplitMode) {
      editDraft((current) => setCalculatorSplitMode(current, splitMode));
    },
    setMemberSelected(memberId: number, selected: boolean) {
      editDraft((current) => setCalculatorMemberSelected(current, memberId, selected));
    },
    updateRatio(memberId: number, value: string) {
      editDraft((current) => updateCalculatorRatio(current, memberId, value));
    },
    updateCustomAmount(memberId: number, value: string) {
      editDraft((current) => updateCalculatorCustomAmount(current, memberId, value));
    },
    deleteMember(memberId: number) {
      const deleted = deleteCalculatorLiabilityMember(draft, memberId);
      if (!deleted.issue) {
        editDraft(deleted.draft);
      }
    },

    startRenameMember(memberId: number, value: string) {
      if (nameEditor) {
        return;
      }
      hideResult();
      setNameEditor({ kind: "member", memberId, value, issue: null });
    },
    startNewMember() {
      if (nameEditor) {
        return;
      }
      hideResult();
      setNameEditor({ kind: "new", value: "", issue: null });
    },
    updateNameEditor(value: string) {
      hideResult();
      setNameEditor((current) => (current ? { ...current, value, issue: null } : current));
    },
    cancelNameEditor() {
      hideResult();
      setNameEditor(null);
    },
    confirmNameEditor() {
      if (!nameEditor) {
        return;
      }
      const result =
        nameEditor.kind === "new"
          ? addCalculatorLiabilityMember(draft, nameEditor.value)
          : renameCalculatorLiabilityMember(draft, nameEditor.memberId, nameEditor.value);
      if (result.issue) {
        setNameEditor({ ...nameEditor, issue: result.issue.message });
        return;
      }
      editDraft(result.draft);
      setNameEditor(null);
    },

    calculate() {
      if (nameEditor) {
        return;
      }
      const result = calculateGroupExpense(draft);
      setDraft(result.draft);
      setIssues(result.issues);
      setPlan(result.plan);
    },
    clearSavedData() {
      const storage = initialState.storage;
      if (storage) {
        try {
          clearCalculatorDraft(storage);
        } catch {
          setStorageWarning(true);
        }
      }
      setDraft(createInitialCalculatorDraft());
      setIssues([]);
      setPlan(null);
      setNameEditor(null);
    },
  };
}

export type GroupExpenseCalculator = ReturnType<typeof useGroupExpenseCalculator>;
