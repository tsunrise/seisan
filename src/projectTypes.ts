export type ProjectAcl = { type: "public" } | { type: "restricted"; emails: string[] };
export type MoneyByMemberId = Record<string, number>;

export interface TransferDestination {
  id: number;
  amount: number;
}

export interface TransferBatch {
  src: number;
  dests: TransferDestination[];
}

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
