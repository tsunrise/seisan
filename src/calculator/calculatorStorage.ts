import type { SplitMode } from "../types";
import {
  CALCULATOR_DRAFT_VERSION,
  calculatorMemberIdentity,
  createInitialCalculatorDraft,
  isCalculatorDraftPristine,
  MAX_CALCULATOR_MEMBER_NAME_LENGTH,
  normalizeCalculatorMemberName,
  type CalculatorDraft,
  type CalculatorMember,
  type CalculatorPayerRow,
} from "./groupExpenseCalculator";

// Browser-only draft persistence for the public calculator. Drafts never leave the browser.
// Version 1 drafts are removed rather than migrated, and malformed or unsupported drafts reset.

export const CALCULATOR_STORAGE_KEY = "seisan:group-expense-calculator:v2";
export const LEGACY_CALCULATOR_STORAGE_KEY = "seisan:group-expense-calculator:v1";
export const CALCULATOR_SAVE_DELAY_MS = 400;

export interface CalculatorDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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
