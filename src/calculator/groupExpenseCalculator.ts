import { createSettlementPlan, type TransferBatch } from "../../shared/settlement";
import { allocateEqual, allocateRatio, normalizeMoneyMap } from "../domain";
import type { SplitMode } from "../types";

export const CALCULATOR_DRAFT_VERSION = 2;
export const CALCULATOR_STORAGE_KEY = "seisan:group-expense-calculator:v2";
export const LEGACY_CALCULATOR_STORAGE_KEY = "seisan:group-expense-calculator:v1";
export const CALCULATOR_SAVE_DELAY_MS = 400;
export const MAX_CALCULATOR_MEMBER_NAME_LENGTH = 100;

export interface CalculatorMember {
  id: number;
  name: string;
}

export interface CalculatorPayerRow {
  key: number;
  memberId: number | null;
  name: string;
  amount: string;
}

export interface CalculatorDraft {
  version: typeof CALCULATOR_DRAFT_VERSION;
  nextMemberId: number;
  nextPayerKey: number;
  members: CalculatorMember[];
  payers: CalculatorPayerRow[];
  splitMode: SplitMode;
  selectedMemberIds: number[];
  ratios: Record<string, string>;
  customAmounts: Record<string, string>;
}

export type CalculatorIssueField =
  | "form"
  | "payerName"
  | "payerAmount"
  | "memberName"
  | "ratio"
  | "custom";

export interface CalculatorIssue {
  field: CalculatorIssueField;
  message: string;
  key?: number;
  memberId?: number;
}

export interface CalculatorPlan {
  transfers: TransferBatch[];
  totalPaid: number;
  paid: Record<string, number>;
  liability: Record<string, number>;
  balance: Record<string, number>;
}

export interface CalculatorAllocationPreview {
  totalPaid: number;
  liability: Record<string, number>;
}

export type CalculatorResult =
  | { ok: true; draft: CalculatorDraft; plan: CalculatorPlan; issues: [] }
  | { ok: false; draft: CalculatorDraft; plan: null; issues: CalculatorIssue[] };

export interface CalculatorDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createInitialCalculatorDraft(): CalculatorDraft {
  return {
    version: CALCULATOR_DRAFT_VERSION,
    nextMemberId: 1,
    nextPayerKey: 2,
    members: [],
    payers: [{ key: 1, memberId: null, name: "", amount: "" }],
    splitMode: "equal",
    selectedMemberIds: [],
    ratios: {},
    customAmounts: {},
  };
}

export function normalizeCalculatorMemberName(name: string): string {
  return name.trim();
}

export function calculatorMemberIdentity(name: string): string {
  return normalizeCalculatorMemberName(name).toLowerCase();
}

export function isCalculatorDraftPristine(draft: CalculatorDraft): boolean {
  return (
    draft.members.length === 0 &&
    draft.payers.length === 1 &&
    draft.payers[0].memberId === null &&
    draft.payers[0].name === "" &&
    draft.payers[0].amount === "" &&
    draft.splitMode === "equal" &&
    draft.selectedMemberIds.length === 0 &&
    Object.keys(draft.ratios).length === 0 &&
    Object.keys(draft.customAmounts).length === 0
  );
}

export function addCalculatorPayer(draft: CalculatorDraft): CalculatorDraft {
  return {
    ...draft,
    nextPayerKey: draft.nextPayerKey + 1,
    payers: [...draft.payers, { key: draft.nextPayerKey, memberId: null, name: "", amount: "" }],
  };
}

export function updateCalculatorPayer(
  draft: CalculatorDraft,
  key: number,
  patch: Partial<Pick<CalculatorPayerRow, "name" | "amount">>,
): CalculatorDraft {
  return {
    ...draft,
    payers: draft.payers.map((payer) => (payer.key === key ? { ...payer, ...patch } : payer)),
  };
}

export function removeCalculatorPayer(draft: CalculatorDraft, key: number): CalculatorDraft {
  const remaining = draft.payers.filter((payer) => payer.key !== key);
  if (remaining.length > 0) {
    return { ...draft, payers: remaining };
  }
  return {
    ...draft,
    nextPayerKey: draft.nextPayerKey + 1,
    payers: [{ key: draft.nextPayerKey, memberId: null, name: "", amount: "" }],
  };
}

export function activeCalculatorPayerMemberIds(draft: CalculatorDraft): Set<number> {
  return new Set(
    draft.payers.flatMap((payer) => (payer.memberId === null ? [] : [payer.memberId])),
  );
}

export function commitCalculatorPayerName(
  draft: CalculatorDraft,
  key: number,
): { draft: CalculatorDraft; issue: CalculatorIssue | null } {
  const payer = draft.payers.find((candidate) => candidate.key === key);
  if (!payer) {
    return { draft, issue: null };
  }

  const name = normalizeCalculatorMemberName(payer.name);
  if (!name) {
    return {
      draft: {
        ...draft,
        payers: draft.payers.map((candidate) =>
          candidate.key === key ? { ...candidate, memberId: null, name: "" } : candidate,
        ),
      },
      issue: null,
    };
  }
  if (name.length > MAX_CALCULATOR_MEMBER_NAME_LENGTH) {
    return {
      draft,
      issue: {
        field: "payerName",
        key,
        message: `Use ${MAX_CALCULATOR_MEMBER_NAME_LENGTH} characters or fewer.`,
      },
    };
  }

  const identity = calculatorMemberIdentity(name);
  const matchingMember = draft.members.find(
    (member) => member.id !== payer.memberId && calculatorMemberIdentity(member.name) === identity,
  );
  const activePayers = activeCalculatorPayerMemberIds(draft);

  if (payer.memberId !== null && matchingMember) {
    return {
      draft,
      issue: {
        field: "payerName",
        key,
        message: "That name is already used by another member.",
      },
    };
  }

  if (payer.memberId === null && matchingMember) {
    if (activePayers.has(matchingMember.id)) {
      return {
        draft,
        issue: {
          field: "payerName",
          key,
          message: "That member is already listed as a payer.",
        },
      };
    }
    return {
      draft: {
        ...draft,
        payers: draft.payers.map((candidate) =>
          candidate.key === key
            ? { ...candidate, memberId: matchingMember.id, name: matchingMember.name }
            : candidate,
        ),
      },
      issue: null,
    };
  }

  if (payer.memberId !== null) {
    return {
      draft: {
        ...draft,
        members: draft.members.map((member) =>
          member.id === payer.memberId ? { ...member, name } : member,
        ),
        payers: draft.payers.map((candidate) =>
          candidate.key === key ? { ...candidate, name } : candidate,
        ),
      },
      issue: null,
    };
  }

  const member: CalculatorMember = { id: draft.nextMemberId, name };
  return {
    draft: {
      ...draft,
      nextMemberId: draft.nextMemberId + 1,
      members: [...draft.members, member],
      payers: draft.payers.map((candidate) =>
        candidate.key === key ? { ...candidate, memberId: member.id, name } : candidate,
      ),
      selectedMemberIds: [...draft.selectedMemberIds, member.id],
      ratios: { ...draft.ratios, [member.id]: "1" },
      customAmounts: { ...draft.customAmounts, [member.id]: "" },
    },
    issue: null,
  };
}

export function addCalculatorLiabilityMember(
  draft: CalculatorDraft,
  rawName: string,
): { draft: CalculatorDraft; issue: CalculatorIssue | null } {
  const name = normalizeCalculatorMemberName(rawName);
  if (!name) {
    return {
      draft,
      issue: { field: "memberName", message: "Enter a member name." },
    };
  }
  if (name.length > MAX_CALCULATOR_MEMBER_NAME_LENGTH) {
    return {
      draft,
      issue: {
        field: "memberName",
        message: `Use ${MAX_CALCULATOR_MEMBER_NAME_LENGTH} characters or fewer.`,
      },
    };
  }
  if (
    draft.members.some(
      (member) => calculatorMemberIdentity(member.name) === calculatorMemberIdentity(name),
    )
  ) {
    return {
      draft,
      issue: { field: "memberName", message: "That member is already in the group." },
    };
  }

  const member: CalculatorMember = { id: draft.nextMemberId, name };
  return {
    draft: {
      ...draft,
      nextMemberId: draft.nextMemberId + 1,
      members: [...draft.members, member],
      selectedMemberIds: [...draft.selectedMemberIds, member.id],
      ratios: { ...draft.ratios, [member.id]: "1" },
      customAmounts: { ...draft.customAmounts, [member.id]: "" },
    },
    issue: null,
  };
}

export function renameCalculatorLiabilityMember(
  draft: CalculatorDraft,
  memberId: number,
  rawName: string,
): { draft: CalculatorDraft; issue: CalculatorIssue | null } {
  if (activeCalculatorPayerMemberIds(draft).has(memberId)) {
    return {
      draft,
      issue: {
        field: "memberName",
        memberId,
        message: "Edit this payer's name in the Who paid section.",
      },
    };
  }
  const name = normalizeCalculatorMemberName(rawName);
  if (!name) {
    return {
      draft,
      issue: { field: "memberName", memberId, message: "Enter a member name." },
    };
  }
  if (name.length > MAX_CALCULATOR_MEMBER_NAME_LENGTH) {
    return {
      draft,
      issue: {
        field: "memberName",
        memberId,
        message: `Use ${MAX_CALCULATOR_MEMBER_NAME_LENGTH} characters or fewer.`,
      },
    };
  }
  if (
    draft.members.some(
      (member) =>
        member.id !== memberId &&
        calculatorMemberIdentity(member.name) === calculatorMemberIdentity(name),
    )
  ) {
    return {
      draft,
      issue: {
        field: "memberName",
        memberId,
        message: "That name is already used by another member.",
      },
    };
  }

  return {
    draft: {
      ...draft,
      members: draft.members.map((member) =>
        member.id === memberId ? { ...member, name } : member,
      ),
    },
    issue: null,
  };
}

export function deleteCalculatorLiabilityMember(
  draft: CalculatorDraft,
  memberId: number,
): { draft: CalculatorDraft; issue: CalculatorIssue | null } {
  if (activeCalculatorPayerMemberIds(draft).has(memberId)) {
    return {
      draft,
      issue: {
        field: "memberName",
        memberId,
        message: "Remove this person from Who paid before deleting them.",
      },
    };
  }
  const ratios = { ...draft.ratios };
  const customAmounts = { ...draft.customAmounts };
  delete ratios[memberId];
  delete customAmounts[memberId];
  return {
    draft: {
      ...draft,
      members: draft.members.filter((member) => member.id !== memberId),
      selectedMemberIds: draft.selectedMemberIds.filter(
        (selectedMemberId) => selectedMemberId !== memberId,
      ),
      ratios,
      customAmounts,
    },
    issue: null,
  };
}

export function setCalculatorSplitMode(
  draft: CalculatorDraft,
  splitMode: SplitMode,
): CalculatorDraft {
  return {
    ...draft,
    splitMode,
    ratios: Object.fromEntries(
      draft.members.map((member) => [String(member.id), draft.ratios[member.id] || "1"]),
    ),
    customAmounts: Object.fromEntries(
      draft.members.map((member) => [String(member.id), draft.customAmounts[member.id] ?? ""]),
    ),
  };
}

export function setCalculatorMemberSelected(
  draft: CalculatorDraft,
  memberId: number,
  selected: boolean,
): CalculatorDraft {
  if (!draft.members.some((member) => member.id === memberId)) {
    return draft;
  }
  const selectedMemberIds = new Set(draft.selectedMemberIds);
  if (selected) {
    selectedMemberIds.add(memberId);
  } else {
    selectedMemberIds.delete(memberId);
  }
  return {
    ...draft,
    selectedMemberIds: draft.members
      .filter((member) => selectedMemberIds.has(member.id))
      .map((member) => member.id),
  };
}

export function updateCalculatorRatio(
  draft: CalculatorDraft,
  memberId: number,
  ratio: string,
): CalculatorDraft {
  return { ...draft, ratios: { ...draft.ratios, [memberId]: ratio } };
}

export function updateCalculatorCustomAmount(
  draft: CalculatorDraft,
  memberId: number,
  amount: string,
): CalculatorDraft {
  return { ...draft, customAmounts: { ...draft.customAmounts, [memberId]: amount } };
}

export function previewCalculatorAllocation(draft: CalculatorDraft): CalculatorAllocationPreview {
  let totalPaidBigInt = 0n;
  for (const payer of draft.payers) {
    const cents = parseCalculatorCents(payer.amount);
    if (cents === null) {
      continue;
    }
    totalPaidBigInt += BigInt(cents);
    if (totalPaidBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { totalPaid: 0, liability: {} };
    }
  }

  const totalPaid = Number(totalPaidBigInt);
  const selectedMemberIds = new Set(draft.selectedMemberIds);
  const selectedMembers = draft.members.filter((member) => selectedMemberIds.has(member.id));
  if (selectedMembers.length === 0) {
    return { totalPaid, liability: {} };
  }

  if (draft.splitMode === "equal") {
    return {
      totalPaid,
      liability:
        totalPaid > 0
          ? allocateEqual(
              totalPaid,
              selectedMembers.map(({ id }) => id),
            )
          : {},
    };
  }

  if (draft.splitMode === "ratio") {
    const ratios: Array<{ memberId: number; ratio: number }> = [];
    for (const member of selectedMembers) {
      const ratio = parseCalculatorRatio(draft.ratios[member.id] ?? "1");
      if (ratio === null) {
        return { totalPaid, liability: {} };
      }
      ratios.push({ memberId: member.id, ratio });
    }
    return {
      totalPaid,
      liability: totalPaid > 0 ? allocateRatio(totalPaid, ratios) : {},
    };
  }

  const liability: Record<string, number> = {};
  for (const member of selectedMembers) {
    const cents = parseCalculatorCents(draft.customAmounts[member.id] ?? "");
    if (cents !== null && cents !== 0) {
      liability[String(member.id)] = cents;
    }
  }
  return { totalPaid, liability };
}

export function calculateGroupExpense(draft: CalculatorDraft): CalculatorResult {
  let committedDraft = draft;
  const issues: CalculatorIssue[] = [];
  for (const payer of draft.payers) {
    const committed = commitCalculatorPayerName(committedDraft, payer.key);
    committedDraft = committed.draft;
    if (committed.issue) {
      issues.push(committed.issue);
    }
  }

  const paid: Record<string, number> = {};
  let paidTotalBigInt = 0n;
  let hasPositivePayer = false;
  for (const payer of committedDraft.payers) {
    const name = normalizeCalculatorMemberName(payer.name);
    const amount = payer.amount.trim();
    if (!name && !amount) {
      continue;
    }
    if (!name || payer.memberId === null) {
      issues.push({
        field: "payerName",
        key: payer.key,
        message: "Enter a member name.",
      });
    }
    if (!amount) {
      issues.push({
        field: "payerAmount",
        key: payer.key,
        message: "Enter the amount paid.",
      });
      continue;
    }
    const cents = parseCalculatorCents(amount);
    if (cents === null || cents <= 0) {
      issues.push({
        field: "payerAmount",
        key: payer.key,
        message: "Enter a positive USD amount with up to two decimals.",
      });
      continue;
    }
    if (payer.memberId === null) {
      continue;
    }
    hasPositivePayer = true;
    paidTotalBigInt += BigInt(cents);
    if (paidTotalBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      issues.push({
        field: "form",
        message: "The total is too large to calculate safely.",
      });
      continue;
    }
    paid[String(payer.memberId)] = (paid[String(payer.memberId)] ?? 0) + cents;
  }

  if (committedDraft.members.length < 2) {
    issues.push({
      field: "form",
      message: "Add at least two named members.",
    });
  }
  if (committedDraft.selectedMemberIds.length === 0) {
    issues.push({
      field: "form",
      message: "Select at least one member to share the expense.",
    });
  }
  if (!hasPositivePayer) {
    issues.push({
      field: "form",
      message: "Add at least one positive payer amount.",
    });
  }
  if (issues.length > 0) {
    return { ok: false, draft: committedDraft, plan: null, issues: uniqueIssues(issues) };
  }

  const totalPaid = Number(paidTotalBigInt);
  const selectedMemberIds = new Set(committedDraft.selectedMemberIds);
  const selectedMembers = committedDraft.members.filter((member) =>
    selectedMemberIds.has(member.id),
  );
  let liability: Record<string, number>;
  if (committedDraft.splitMode === "equal") {
    liability = allocateEqual(
      totalPaid,
      selectedMembers.map((member) => member.id),
    );
  } else if (committedDraft.splitMode === "ratio") {
    const parsedRatios: Array<{ memberId: number; ratio: number }> = [];
    for (const member of selectedMembers) {
      const rawRatio = committedDraft.ratios[member.id] ?? "1";
      const ratio = parseCalculatorRatio(rawRatio);
      if (ratio === null) {
        issues.push({
          field: "ratio",
          memberId: member.id,
          message: "Enter a positive decimal ratio.",
        });
      } else {
        parsedRatios.push({ memberId: member.id, ratio });
      }
    }
    liability = issues.length === 0 ? allocateRatio(totalPaid, parsedRatios) : {};
  } else {
    liability = {};
    let customTotal = 0n;
    for (const member of selectedMembers) {
      const cents = parseCalculatorCents(committedDraft.customAmounts[member.id] ?? "");
      if (cents === null) {
        issues.push({
          field: "custom",
          memberId: member.id,
          message: "Enter a non-negative USD amount with up to two decimals.",
        });
        continue;
      }
      customTotal += BigInt(cents);
      if (cents !== 0) {
        liability[String(member.id)] = cents;
      }
    }
    if (customTotal !== paidTotalBigInt) {
      issues.push({
        field: "form",
        message: "Custom shares must add up exactly to the amount paid.",
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, draft: committedDraft, plan: null, issues: uniqueIssues(issues) };
  }

  const balance: Record<string, number> = {};
  for (const member of committedDraft.members) {
    const memberId = String(member.id);
    balance[memberId] = (liability[memberId] ?? 0) - (paid[memberId] ?? 0);
  }
  const normalizedBalance = normalizeMoneyMap(balance);
  const transfers = createSettlementPlan(normalizedBalance);
  if (!transfers) {
    return {
      ok: false,
      draft: committedDraft,
      plan: null,
      issues: [{ field: "form", message: "The settlement could not be calculated safely." }],
    };
  }

  return {
    ok: true,
    draft: committedDraft,
    issues: [],
    plan: {
      transfers,
      totalPaid,
      paid: normalizeMoneyMap(paid),
      liability: normalizeMoneyMap(liability),
      balance: normalizedBalance,
    },
  };
}

export function parseCalculatorCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(?:\.\d{0,2})?$/u.test(trimmed)) {
    return null;
  }
  const [dollars, decimal = ""] = trimmed.split(".");
  const cents = BigInt(dollars) * 100n + BigInt(decimal.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

export function parseCalculatorRatio(input: string): number | null {
  const trimmed = input.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(trimmed)) {
    return null;
  }
  const ratio = Number(trimmed);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export function serializeCalculatorDraft(draft: CalculatorDraft): string {
  return JSON.stringify(draft);
}

export function parseCalculatorDraft(serialized: string): CalculatorDraft | null {
  try {
    const input = JSON.parse(serialized) as unknown;
    if (!isRecord(input) || input.version !== CALCULATOR_DRAFT_VERSION) {
      return null;
    }
    if (
      !isPositiveSafeInteger(input.nextMemberId) ||
      !isPositiveSafeInteger(input.nextPayerKey) ||
      !Array.isArray(input.members) ||
      !Array.isArray(input.payers) ||
      !Array.isArray(input.selectedMemberIds) ||
      !isSplitMode(input.splitMode) ||
      !isStringRecord(input.ratios) ||
      !isStringRecord(input.customAmounts)
    ) {
      return null;
    }
    const ratios = input.ratios;
    const customAmounts = input.customAmounts;

    const members: CalculatorMember[] = [];
    const memberIds = new Set<number>();
    const identities = new Set<string>();
    for (const value of input.members) {
      if (!isRecord(value) || !isPositiveSafeInteger(value.id) || typeof value.name !== "string") {
        return null;
      }
      const name = normalizeCalculatorMemberName(value.name);
      const identity = calculatorMemberIdentity(name);
      if (
        !name ||
        name.length > MAX_CALCULATOR_MEMBER_NAME_LENGTH ||
        memberIds.has(value.id) ||
        identities.has(identity)
      ) {
        return null;
      }
      memberIds.add(value.id);
      identities.add(identity);
      members.push({ id: value.id, name });
    }

    const payers: CalculatorPayerRow[] = [];
    const payerKeys = new Set<number>();
    const payerMemberIds = new Set<number>();
    for (const value of input.payers) {
      if (
        !isRecord(value) ||
        !isPositiveSafeInteger(value.key) ||
        (value.memberId !== null && !isPositiveSafeInteger(value.memberId)) ||
        typeof value.name !== "string" ||
        typeof value.amount !== "string" ||
        payerKeys.has(value.key)
      ) {
        return null;
      }
      if (
        value.memberId !== null &&
        (!memberIds.has(value.memberId) || payerMemberIds.has(value.memberId))
      ) {
        return null;
      }
      payerKeys.add(value.key);
      if (value.memberId !== null) {
        payerMemberIds.add(value.memberId);
      }
      payers.push({
        key: value.key,
        memberId: value.memberId,
        name: value.name,
        amount: value.amount,
      });
    }
    if (payers.length === 0) {
      return null;
    }

    const selectedMemberIds = new Set<number>();
    for (const memberId of input.selectedMemberIds) {
      if (
        !isPositiveSafeInteger(memberId) ||
        !memberIds.has(memberId) ||
        selectedMemberIds.has(memberId)
      ) {
        return null;
      }
      selectedMemberIds.add(memberId);
    }

    const maxMemberId = members.reduce((maximum, member) => Math.max(maximum, member.id), 0);
    const maxPayerKey = payers.reduce((maximum, payer) => Math.max(maximum, payer.key), 0);
    if (input.nextMemberId <= maxMemberId || input.nextPayerKey <= maxPayerKey) {
      return null;
    }

    return {
      version: CALCULATOR_DRAFT_VERSION,
      nextMemberId: input.nextMemberId,
      nextPayerKey: input.nextPayerKey,
      members,
      payers,
      splitMode: input.splitMode,
      selectedMemberIds: members
        .filter((member) => selectedMemberIds.has(member.id))
        .map((member) => member.id),
      ratios: Object.fromEntries(
        members.map((member) => [String(member.id), ratios[String(member.id)] ?? "1"]),
      ),
      customAmounts: Object.fromEntries(
        members.map((member) => [String(member.id), customAmounts[String(member.id)] ?? ""]),
      ),
    };
  } catch {
    return null;
  }
}

export function loadCalculatorDraft(storage: CalculatorDraftStorage): CalculatorDraft {
  storage.removeItem(LEGACY_CALCULATOR_STORAGE_KEY);
  const serialized = storage.getItem(CALCULATOR_STORAGE_KEY);
  if (serialized === null) {
    return createInitialCalculatorDraft();
  }
  const draft = parseCalculatorDraft(serialized);
  if (draft) {
    return draft;
  }
  storage.removeItem(CALCULATOR_STORAGE_KEY);
  return createInitialCalculatorDraft();
}

export function saveCalculatorDraft(storage: CalculatorDraftStorage, draft: CalculatorDraft): void {
  storage.removeItem(LEGACY_CALCULATOR_STORAGE_KEY);
  if (isCalculatorDraftPristine(draft)) {
    storage.removeItem(CALCULATOR_STORAGE_KEY);
    return;
  }
  storage.setItem(CALCULATOR_STORAGE_KEY, serializeCalculatorDraft(draft));
}

export function clearCalculatorDraft(storage: CalculatorDraftStorage): void {
  storage.removeItem(CALCULATOR_STORAGE_KEY);
  storage.removeItem(LEGACY_CALCULATOR_STORAGE_KEY);
}

export function scheduleCalculatorDraftSave(
  storage: CalculatorDraftStorage,
  draft: CalculatorDraft,
  onError: () => void,
  delayMs = CALCULATOR_SAVE_DELAY_MS,
): () => void {
  const timer = setTimeout(() => {
    try {
      saveCalculatorDraft(storage, draft);
    } catch {
      onError();
    }
  }, delayMs);
  return () => clearTimeout(timer);
}

function uniqueIssues(issues: CalculatorIssue[]): CalculatorIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.field}:${issue.key ?? ""}:${issue.memberId ?? ""}:${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isPositiveSafeInteger(input: unknown): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) && input > 0;
}

function isStringRecord(input: unknown): input is Record<string, string> {
  return isRecord(input) && Object.values(input).every((value) => typeof value === "string");
}

function isSplitMode(input: unknown): input is SplitMode {
  return input === "equal" || input === "ratio" || input === "custom";
}
