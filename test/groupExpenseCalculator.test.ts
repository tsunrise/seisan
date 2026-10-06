import { afterEach, describe, expect, it, vi } from "vitest";

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
} from "../src/calculator/groupExpenseCalculator";
import {
  CALCULATOR_SAVE_DELAY_MS,
  CALCULATOR_STORAGE_KEY,
  clearCalculatorDraft,
  LEGACY_CALCULATOR_STORAGE_KEY,
  loadCalculatorDraft,
  parseCalculatorDraft,
  saveCalculatorDraft,
  scheduleCalculatorDraftSave,
  serializeCalculatorDraft,
  type CalculatorDraftStorage,
} from "../src/calculator/calculatorStorage";

function addMember(draft: CalculatorDraft, name: string): CalculatorDraft {
  const result = addCalculatorLiabilityMember(draft, name);
  expect(result.issue).toBeNull();
  return result.draft;
}

function setPayer(
  draft: CalculatorDraft,
  key: number,
  name: string,
  amount: string,
): CalculatorDraft {
  const edited = updateCalculatorPayer(draft, key, { name, amount });
  const committed = commitCalculatorPayerName(edited, key);
  expect(committed.issue).toBeNull();
  return committed.draft;
}

function memoryStorage(initial: Record<string, string> = {}): CalculatorDraftStorage & {
  values: Record<string, string>;
} {
  const values = { ...initial };
  return {
    values,
    getItem(key) {
      return values[key] ?? null;
    },
    setItem(key, value) {
      values[key] = value;
    },
    removeItem(key) {
      delete values[key];
    },
  };
}

describe("group expense calculator identity", () => {
  it("normalizes names for case-insensitive uniqueness and promotes liability-only members", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = updateCalculatorPayer(draft, 1, { name: "  alice  ", amount: "10.00" });

    const committed = commitCalculatorPayerName(draft, 1);

    expect(committed.issue).toBeNull();
    expect(committed.draft.members).toEqual([{ id: 1, name: "Alice" }]);
    expect(committed.draft.payers[0]).toMatchObject({ memberId: 1, name: "Alice" });
    expect(committed.draft.selectedMemberIds).toEqual([1]);
  });

  it("selects new members by default and preserves selection when promoting a payer", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    expect(draft.selectedMemberIds).toEqual([1]);

    draft = setCalculatorMemberSelected(draft, 1, false);
    draft = updateCalculatorPayer(draft, 1, { name: "alice", amount: "10" });
    const promoted = commitCalculatorPayerName(draft, 1);

    expect(promoted.issue).toBeNull();
    expect(promoted.draft.payers[0].memberId).toBe(1);
    expect(promoted.draft.selectedMemberIds).toEqual([]);

    let payerCreated = updateCalculatorPayer(createInitialCalculatorDraft(), 1, {
      name: "Bob",
      amount: "10",
    });
    payerCreated = commitCalculatorPayerName(payerCreated, 1).draft;
    expect(payerCreated.selectedMemberIds).toEqual([1]);
  });

  it("rejects collisions when renaming a payer into another member", () => {
    let draft = setPayer(createInitialCalculatorDraft(), 1, "Alice", "12.00");
    draft = addMember(draft, "Bob");
    draft = updateCalculatorPayer(draft, 1, { name: " bob " });

    const committed = commitCalculatorPayerName(draft, 1);

    expect(committed.issue?.message).toContain("already used");
    expect(committed.draft.members).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });

  it("propagates a payer rename to its liability member", () => {
    let draft = setPayer(createInitialCalculatorDraft(), 1, "Alice", "12.00");
    draft = updateCalculatorPayer(draft, 1, { name: "Alicia" });

    const committed = commitCalculatorPayerName(draft, 1);

    expect(committed.issue).toBeNull();
    expect(committed.draft.members[0].name).toBe("Alicia");
    expect(committed.draft.payers[0].name).toBe("Alicia");
  });

  it("retains a removed payer as a liability member and protects active payers from deletion", () => {
    const draft = setPayer(createInitialCalculatorDraft(), 1, "Alice", "12.00");

    const protectedDelete = deleteCalculatorLiabilityMember(draft, 1);
    expect(protectedDelete.issue?.message).toContain("Who paid");
    expect(activeCalculatorPayerMemberIds(draft)).toEqual(new Set([1]));

    const removed = removeCalculatorPayer(draft, 1);
    expect(removed.members).toEqual([{ id: 1, name: "Alice" }]);
    expect(removed.payers).toHaveLength(1);
    expect(removed.payers[0].memberId).toBeNull();

    const deleted = deleteCalculatorLiabilityMember(removed, 1);
    expect(deleted.issue).toBeNull();
    expect(deleted.draft.members).toEqual([]);
    expect(deleted.draft.selectedMemberIds).toEqual([]);
    expect(deleted.draft.ratios).toEqual({});
    expect(deleted.draft.customAmounts).toEqual({});
  });

  it("rejects liability member rename collisions", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = addMember(draft, "Bob");

    const renamed = renameCalculatorLiabilityMember(draft, 2, " ALICE ");

    expect(renamed.issue?.message).toContain("already used");
    expect(renamed.draft.members[1].name).toBe("Bob");
  });
});

describe("group expense calculator validation and allocation", () => {
  it("ignores fully blank payer rows", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = addMember(draft, "Bob");
    draft = setPayer(draft, 1, "Alice", "10");
    draft = addCalculatorPayer(draft);

    const result = calculateGroupExpense(draft);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.totalPaid).toBe(1_000);
      expect(result.plan.transfers).toEqual([{ src: 2, dests: [{ id: 1, amount: 500 }] }]);
    }
  });

  it("requires two members and at least one positive complete payer row", () => {
    let draft = setPayer(createInitialCalculatorDraft(), 1, "Alice", "10");
    let result = calculateGroupExpense(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.message)).toContain(
        "Add at least two named members.",
      );
    }

    draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = addMember(draft, "Bob");
    draft = updateCalculatorPayer(draft, 1, { amount: "10" });
    result = calculateGroupExpense(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.field === "payerName")).toBe(true);
    }
  });

  it("rejects incomplete payer rows and unsafe cent values", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = addMember(draft, "Bob");
    draft = updateCalculatorPayer(draft, 1, { name: "Alice", amount: "" });
    let result = calculateGroupExpense(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.field === "payerAmount")).toBe(true);
    }

    draft = updateCalculatorPayer(draft, 1, { amount: "90071992547409.92" });
    result = calculateGroupExpense(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.field === "payerAmount")).toBe(true);
    }
  });

  it("allocates equal splits by stable member ID", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = addMember(draft, "Bob");
    draft = addMember(draft, "Carol");
    draft = setPayer(draft, 1, "Carol", "0.01");

    const result = calculateGroupExpense(draft);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.liability).toEqual({ "1": 1 });
      expect(result.plan.transfers).toEqual([{ src: 1, dests: [{ id: 3, amount: 1 }] }]);
    }
  });

  it("accepts positive decimal ratios", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = addMember(draft, "Bob");
    draft = setPayer(draft, 1, "Alice", "10");
    draft = setCalculatorSplitMode(draft, "ratio");
    draft = updateCalculatorRatio(draft, 1, "0.5");
    draft = updateCalculatorRatio(draft, 2, "1.5");

    const result = calculateGroupExpense(draft);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.liability).toEqual({ "1": 250, "2": 750 });
      expect(result.plan.transfers).toEqual([{ src: 2, dests: [{ id: 1, amount: 750 }] }]);
    }
  });

  it("retains ratio and custom values while members are unchecked and rechecked", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = updateCalculatorRatio(draft, 1, "2.5");
    draft = updateCalculatorCustomAmount(draft, 1, "7.25");

    draft = setCalculatorMemberSelected(draft, 1, false);
    expect(draft.ratios[1]).toBe("2.5");
    expect(draft.customAmounts[1]).toBe("7.25");

    draft = setCalculatorMemberSelected(draft, 1, true);
    expect(draft.selectedMemberIds).toEqual([1]);
    expect(draft.ratios[1]).toBe("2.5");
    expect(draft.customAmounts[1]).toBe("7.25");
  });

  it("requires at least one selected member", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = addMember(draft, "Bob");
    draft = setPayer(draft, 1, "Alice", "10");
    draft = setCalculatorMemberSelected(draft, 1, false);
    draft = setCalculatorMemberSelected(draft, 2, false);

    const result = calculateGroupExpense(draft);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.message)).toContain(
        "Select at least one member to share the expense.",
      );
    }
  });

  it("allocates only selected members in every split mode", () => {
    let equalDraft = addMember(createInitialCalculatorDraft(), "Alice");
    equalDraft = addMember(equalDraft, "Bob");
    equalDraft = addMember(equalDraft, "Carol");
    equalDraft = setPayer(equalDraft, 1, "Alice", "10");
    equalDraft = setCalculatorMemberSelected(equalDraft, 2, false);

    const equal = calculateGroupExpense(equalDraft);
    expect(equal.ok && equal.plan.liability).toEqual({ "1": 500, "3": 500 });

    let ratioDraft = setCalculatorSplitMode(equalDraft, "ratio");
    ratioDraft = updateCalculatorRatio(ratioDraft, 1, "1");
    ratioDraft = updateCalculatorRatio(ratioDraft, 2, "invalid");
    ratioDraft = updateCalculatorRatio(ratioDraft, 3, "3");
    const ratio = calculateGroupExpense(ratioDraft);
    expect(ratio.ok && ratio.plan.liability).toEqual({ "1": 250, "3": 750 });

    let customDraft = setCalculatorSplitMode(equalDraft, "custom");
    customDraft = updateCalculatorCustomAmount(customDraft, 1, "4");
    customDraft = updateCalculatorCustomAmount(customDraft, 2, "invalid");
    customDraft = updateCalculatorCustomAmount(customDraft, 3, "6");
    const custom = calculateGroupExpense(customDraft);
    expect(custom.ok && custom.plan.liability).toEqual({ "1": 400, "3": 600 });
  });

  it("previews equal and ratio allocations only when they can resolve safely", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = addMember(draft, "Bob");
    draft = updateCalculatorPayer(draft, 1, { amount: "10.01" });

    expect(previewCalculatorAllocation(draft)).toEqual({
      totalPaid: 1_001,
      liability: { "1": 501, "2": 500 },
    });

    draft = setCalculatorSplitMode(draft, "ratio");
    draft = updateCalculatorRatio(draft, 1, "1");
    draft = updateCalculatorRatio(draft, 2, "");
    expect(previewCalculatorAllocation(draft)).toEqual({
      totalPaid: 1_001,
      liability: {},
    });

    draft = setCalculatorMemberSelected(draft, 2, false);
    expect(previewCalculatorAllocation(draft)).toEqual({
      totalPaid: 1_001,
      liability: { "1": 1_001 },
    });

    draft = updateCalculatorPayer(draft, 1, { amount: "90071992547409.92" });
    expect(previewCalculatorAllocation(draft)).toEqual({ totalPaid: 0, liability: {} });
  });

  it("previews valid custom shares before their total balances", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = addMember(draft, "Bob");
    draft = addMember(draft, "Carol");
    draft = updateCalculatorPayer(draft, 1, { amount: "10" });
    draft = setCalculatorSplitMode(draft, "custom");
    draft = updateCalculatorCustomAmount(draft, 1, "2.25");
    draft = updateCalculatorCustomAmount(draft, 2, "invalid");
    draft = updateCalculatorCustomAmount(draft, 3, "3");
    draft = setCalculatorMemberSelected(draft, 3, false);

    expect(previewCalculatorAllocation(draft)).toEqual({
      totalPaid: 1_000,
      liability: { "1": 225 },
    });
  });

  it("accepts zero custom shares and rejects a custom-total mismatch", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = addMember(draft, "Bob");
    draft = setPayer(draft, 1, "Alice", "10");
    draft = setCalculatorSplitMode(draft, "custom");
    draft = updateCalculatorCustomAmount(draft, 1, "0");
    draft = updateCalculatorCustomAmount(draft, 2, "10");

    let result = calculateGroupExpense(draft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.liability).toEqual({ "2": 1_000 });
    }

    draft = updateCalculatorCustomAmount(draft, 2, "9.99");
    result = calculateGroupExpense(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.message)).toContain(
        "Custom shares must add up exactly to the amount paid.",
      );
    }
  });

  it("returns a valid zero-transfer result", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = addMember(draft, "Bob");
    draft = setPayer(draft, 1, "Alice", "5");
    draft = addCalculatorPayer(draft);
    draft = setPayer(draft, 2, "Bob", "5");

    const result = calculateGroupExpense(draft);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.transfers).toEqual([]);
      expect(result.plan.balance).toEqual({});
    }
  });
});

describe("group expense calculator persistence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips a versioned draft and discards malformed or unsupported data", () => {
    let draft = addMember(createInitialCalculatorDraft(), "Alice");
    draft = updateCalculatorPayer(draft, 1, { name: "Alice", amount: "12.34" });

    expect(parseCalculatorDraft(serializeCalculatorDraft(draft))).toEqual(draft);
    expect(parseCalculatorDraft("{")).toBeNull();
    expect(parseCalculatorDraft(JSON.stringify({ ...draft, version: 3 }))).toBeNull();
    expect(parseCalculatorDraft(JSON.stringify({ ...draft, selectedMemberIds: [999] }))).toBeNull();
    expect(
      parseCalculatorDraft(JSON.stringify({ ...draft, selectedMemberIds: [1, 1] })),
    ).toBeNull();

    const storage = memoryStorage({ [CALCULATOR_STORAGE_KEY]: "not-json" });
    expect(loadCalculatorDraft(storage)).toEqual(createInitialCalculatorDraft());
    expect(storage.values[CALCULATOR_STORAGE_KEY]).toBeUndefined();
  });

  it("removes legacy v1 storage and starts from a blank v2 draft", () => {
    const legacyDraft = {
      ...createInitialCalculatorDraft(),
      version: 1,
      selectedMemberIds: undefined,
    };
    const storage = memoryStorage({
      [LEGACY_CALCULATOR_STORAGE_KEY]: JSON.stringify(legacyDraft),
    });

    expect(loadCalculatorDraft(storage)).toEqual(createInitialCalculatorDraft());
    expect(storage.values[LEGACY_CALCULATOR_STORAGE_KEY]).toBeUndefined();
  });

  it("debounces the latest draft save by 400 ms and supports cancellation", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    let draft = updateCalculatorPayer(createInitialCalculatorDraft(), 1, {
      name: "Alice",
      amount: "1",
    });

    const cancelFirst = scheduleCalculatorDraftSave(storage, draft, () => undefined);
    vi.advanceTimersByTime(CALCULATOR_SAVE_DELAY_MS - 1);
    expect(storage.values[CALCULATOR_STORAGE_KEY]).toBeUndefined();
    cancelFirst();

    draft = updateCalculatorPayer(draft, 1, { amount: "2" });
    scheduleCalculatorDraftSave(storage, draft, () => undefined);
    vi.advanceTimersByTime(CALCULATOR_SAVE_DELAY_MS);

    expect(parseCalculatorDraft(storage.values[CALCULATOR_STORAGE_KEY])?.payers[0].amount).toBe(
      "2",
    );
  });

  it("reports a storage write failure without interrupting the draft", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const storage: CalculatorDraftStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => undefined,
    };
    const draft = updateCalculatorPayer(createInitialCalculatorDraft(), 1, {
      name: "Alice",
      amount: "2",
    });

    scheduleCalculatorDraftSave(storage, draft, onError);
    vi.advanceTimersByTime(CALCULATOR_SAVE_DELAY_MS);

    expect(onError).toHaveBeenCalledOnce();
    expect(draft.payers[0]).toMatchObject({ name: "Alice", amount: "2" });
  });

  it("removes pristine and explicitly cleared data", () => {
    const storage = memoryStorage({
      [CALCULATOR_STORAGE_KEY]: "old",
      [LEGACY_CALCULATOR_STORAGE_KEY]: "legacy",
    });

    saveCalculatorDraft(storage, createInitialCalculatorDraft());
    expect(storage.values[CALCULATOR_STORAGE_KEY]).toBeUndefined();
    expect(storage.values[LEGACY_CALCULATOR_STORAGE_KEY]).toBeUndefined();

    storage.values[CALCULATOR_STORAGE_KEY] = "old";
    storage.values[LEGACY_CALCULATOR_STORAGE_KEY] = "legacy";
    clearCalculatorDraft(storage);
    expect(storage.values[CALCULATOR_STORAGE_KEY]).toBeUndefined();
    expect(storage.values[LEGACY_CALCULATOR_STORAGE_KEY]).toBeUndefined();
  });
});
