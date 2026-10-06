import type {
  ProjectMember,
  TransferBatch,
  TransferDestination,
  WritableRecordDescription,
} from "../../api/types";
import {
  activeMembers,
  formatCentsInput,
  parseCents,
  transferDestinations,
  transferSourceMemberId,
} from "../../domain";

export interface TransferDestinationDraft {
  key: number;
  memberId: number | null;
  amount: string;
}

export interface TransferPrefill {
  from: number;
  to: number;
  amount: string;
}

export function transferDraftFromDescription(
  description: Extract<WritableRecordDescription, { type: "transfer" }>,
): { sourceId: number; destinations: TransferDestinationDraft[] } {
  return {
    sourceId: transferSourceMemberId(description),
    destinations: transferDestinations(description).map((destination, index) => ({
      key: index,
      memberId: destination.id,
      amount: formatCentsInput(destination.amount),
    })),
  };
}

export function availableDestinationMembers(
  members: ProjectMember[],
  sourceId: number,
  destinations: TransferDestinationDraft[],
  destinationKey: number,
): ProjectMember[] {
  const selectedByOtherRows = new Set(
    destinations
      .filter((destination) => destination.key !== destinationKey)
      .flatMap((destination) => (destination.memberId === null ? [] : [destination.memberId])),
  );
  return members.filter((member) => member.id !== sourceId && !selectedByOtherRows.has(member.id));
}

export function parseTransferDestinations(
  destinations: TransferDestinationDraft[],
): TransferDestination[] | null {
  const parsed: TransferDestination[] = [];
  const seen = new Set<number>();
  let total = 0;
  for (const destination of destinations) {
    const amount = parseCents(destination.amount);
    if (
      destination.memberId === null ||
      seen.has(destination.memberId) ||
      amount === null ||
      amount <= 0
    ) {
      return null;
    }
    seen.add(destination.memberId);
    total += amount;
    if (!Number.isSafeInteger(total)) {
      return null;
    }
    parsed.push({ id: destination.memberId, amount });
  }
  return parsed.length > 0 ? parsed : null;
}

export function transferBatchTotal(transfer: Pick<TransferBatch, "dests">): number {
  return transfer.dests.reduce((total, destination) => total + destination.amount, 0);
}

export function transferPrefillFromSearch(
  search: URLSearchParams,
  members: ProjectMember[],
): TransferPrefill | null {
  if (search.get("mode") !== "transfer") {
    return null;
  }
  const from = Number(search.get("from"));
  const to = Number(search.get("to"));
  const amount = search.get("amount") ?? "";
  const activeMemberIds = new Set(activeMembers(members).map((member) => member.id));
  const cents = parseCents(amount);
  if (
    !activeMemberIds.has(from) ||
    !activeMemberIds.has(to) ||
    from === to ||
    cents === null ||
    cents <= 0
  ) {
    return null;
  }
  return { from, to, amount: formatCentsInput(cents) };
}

export function transferPrefillSearch(transfer: TransferBatch, destinationId: number): string {
  const destination = transfer.dests.find((candidate) => candidate.id === destinationId);
  if (!destination) {
    return "";
  }
  const search = new URLSearchParams({
    mode: "transfer",
    from: String(transfer.src),
    to: String(destination.id),
    amount: formatCentsInput(destination.amount),
  });
  return search.toString();
}
