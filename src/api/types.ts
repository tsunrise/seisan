export type { MoneyByMemberId, TransferBatch, TransferDestination } from "../../shared/settlement";
import type { IconName } from "../../shared/icon-names";
import type { MoneyByMemberId, TransferBatch } from "../../shared/settlement";

export type ProjectAcl = { type: "public" } | { type: "restricted"; emails: string[] };

export interface ProjectMemberConfig {
  size?: number;
  paymentMethod?: string;
}

export interface ProjectMember {
  id: number;
  name: string;
  deleted: boolean;
  linkedEmail?: string;
}

export interface ProjectMemberFull extends ProjectMember {
  config?: ProjectMemberConfig;
}

export type RecordDescription =
  | {
      type: "expense";
      name: string;
      paid: MoneyByMemberId;
      liability: MoneyByMemberId;
      categoryId?: string;
    }
  | {
      type: "transfer";
      from: number;
      to: number;
      amount: number;
    }
  | ({ type: "transfer" } & TransferBatch)
  | {
      type: "promise";
      debtorMemberId: number;
      creditorMemberId: number;
      amount: number;
      reason?: string;
    }
  | {
      type: "revert";
      id: number;
    }
  | {
      type: "deleted";
    };

export type WritableRecordDescription = Exclude<
  RecordDescription,
  { type: "revert" } | { type: "deleted" }
>;

export interface ProjectRecord {
  id: number;
  authorMemberId: number;
  delta: MoneyByMemberId;
  description: RecordDescription;
  createdAt: number;
  updatedAt?: number;
  updatedByMemberId?: number;
}

export interface ProjectCreated {
  id: string;
  name: string;
  owner: string;
  acl: ProjectAcl;
  members: ProjectMember[];
}

export interface Project extends ProjectCreated {
  members: ProjectMemberFull[];
  records: ProjectRecord[];
  balance: MoneyByMemberId;
  updatedAt: number;
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

export interface Category {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  icon?: IconName;
  documentText: string;
  vectorId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CategoryCandidate {
  category: Category;
  score: number;
}

export interface CategoryClassification {
  category: Category;
  score: number;
  candidates: CategoryCandidate[];
}

export interface Limits {
  "projects.maxLinkedProjects": number;
  "projects.maxOwnedProjects": number;
  "projects.maxMembersPerProject": number;
  "projects.maxProjectNameLength": number;
  "projects.maxMemberNameLength": number;
  "projects.maxAclEmails": number;
  "apikeys.max_keys": number;
  "apikeys.max_expiry": number;
  "records.allow_post": boolean;
  "records.defaultPageSize": number;
  "records.maxPageSize": number;
  "records.maxRecordsPerOwnedProject": number;
  "records.maxExpenseNameLength": number;
  "money.maxAmountCents": number;
  "money.maxBalanceCents": number;
}

export type LimitName = keyof Limits;
export type LimitValue = Limits[LimitName] | boolean;
export type LimitsDocument = Partial<Record<LimitName, LimitValue>>;

export interface AdminLimitDefinition {
  name: LimitName;
  type: "integer" | "boolean";
}

export interface AdminPage {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

export interface AdminProject {
  id: string;
  name: string;
  owner: string;
  recordCount: number;
  memberCount: number;
  updatedAt: number;
  lastSyncAt: number;
}

export type AdminProjectSort = "records_desc" | "updated_desc" | "updated_asc";

export interface AdminOwnerSummary {
  owner: string;
  projectCount: number;
  recordCount: number;
  updatedAt: number;
}

export interface AdminIdentity {
  ok: true;
  email: string | null;
  local: boolean;
}

export interface BlockedEmailRule {
  pattern: string;
  reason?: string;
}

export interface BlockedEmailsDocument {
  version: 1;
  patterns: BlockedEmailRule[];
}

export interface AdminBlockedEmailTestResult {
  email: string;
  blocked: boolean;
  matchedPattern: string | null;
  reason?: string;
}

export interface ApiKeyMetadata {
  id: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface CreatedApiKey {
  apiKey: string;
  key: ApiKeyMetadata;
}
