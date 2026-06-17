import { z } from "zod";

import { normalizeEmail } from "./email";

export const PROJECTS_REGISTRY_NAME = "projects";
export const PROJECT_SUMMARY_SYNC_DELAY_MS = 10_000;
// TODO: Give user an option to archive a record (e.g. delete DO but save the records in KV).

const projectIdRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const ProjectId = z
  .string()
  .regex(projectIdRegex)
  .transform((id) => id.toLowerCase());
export type ProjectId = z.infer<typeof ProjectId>;

export type Cents = number;
export type MemberId = number;
export type MemberName = string;
export type ProjectName = string;
export type MoneyByMemberId = Record<string, number>;

export class ProjectNameUtils {
  static normalizeMember(name: string): string {
    return name.trim().replace(/\s+/gu, " ");
  }

  static normalizeProject(name: string): string {
    return name.trim().replace(/\s+/gu, " ");
  }
}

export class ProjectEmailsUtils {
  static uniqueSorted(emails: string[]): string[] {
    return [...new Set(emails.map(normalizeEmail))].sort();
  }
}

export class MoneyByMemberIdUtils {
  static normalize(input: MoneyByMemberId): MoneyByMemberId {
    const result: MoneyByMemberId = {};
    for (const [memberId, amount] of Object.entries(input)) {
      this.add(result, memberId, amount);
    }
    return result;
  }

  static add(map: MoneyByMemberId, memberId: string | number, amount: number): MoneyByMemberId {
    if (amount === 0) {
      return map;
    }

    const normalizedMemberId = String(Number(memberId));
    const nextAmount = (map[normalizedMemberId] ?? 0) + amount;
    if (nextAmount === 0) {
      delete map[normalizedMemberId];
      return map;
    }

    map[normalizedMemberId] = nextAmount;
    return map;
  }

  static negate(input: MoneyByMemberId): MoneyByMemberId {
    const result: MoneyByMemberId = {};
    for (const [memberId, amount] of this.entries(input)) {
      this.add(result, memberId, -amount);
    }
    return result;
  }

  static equals(left: MoneyByMemberId, right: MoneyByMemberId): boolean {
    const leftEntries = this.entries(left);
    const rightEntries = this.entries(right);
    if (leftEntries.length !== rightEntries.length) {
      return false;
    }
    return leftEntries.every(([memberId, amount], index) => {
      const [rightMemberId, rightAmount] = rightEntries[index];
      return memberId === rightMemberId && amount === rightAmount;
    });
  }

  static sum(input: MoneyByMemberId): number {
    return this.values(input).reduce((total, amount) => total + amount, 0);
  }

  static members(input: MoneyByMemberId): string[] {
    return this.entries(input).map(([memberId]) => memberId);
  }

  private static values(input: MoneyByMemberId): number[] {
    return this.entries(input).map(([, amount]) => amount);
  }

  static entries(input: MoneyByMemberId): Array<[string, number]> {
    return Object.entries(this.normalize(input)).sort(
      ([left], [right]) => Number(left) - Number(right),
    );
  }
}

export type ExpenseDescription = {
  type: "expense";
  name: string;
  paid: MoneyByMemberId;
  liability: MoneyByMemberId;
};

export type TransferDescription = {
  type: "transfer";
  from: MemberId;
  to: MemberId;
  amount: Cents;
};

export type RevertDescription = {
  type: "revert";
  id: number;
};

export type RecordDescription = ExpenseDescription | TransferDescription | RevertDescription;

export type ProjectAcl = { type: "public" } | { type: "restricted"; emails: string[] };
export type ProjectAclType = ProjectAcl["type"];

export type ProjectMemberPatch = { name: MemberName } | { email: "" };
export type ProjectJoin = { memberId: MemberId } | { name: MemberName };

export interface ProjectMember {
  id: number;
  name: string;
  deleted: boolean;
  linkedEmail?: string;
}

export interface ProjectRecord {
  id: number;
  authorMemberId: number;
  delta: MoneyByMemberId;
  description: RecordDescription;
  createdAt: number;
  reverted?: {
    recordId: number;
    authorMemberId: number;
    createdAt: number;
  };
}

export interface ProjectSummary {
  id: string;
  name: string;
  owner: string;
  member: ProjectMember | null;
  balance: number | null;
  updatedAt: number;
}

export type WithSyncTime<T> = T & { lastSyncAt: number };
