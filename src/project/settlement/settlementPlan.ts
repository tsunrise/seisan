import type { TransferBatch } from "../../api/types";

/** One row of a settlement list: the other member and the amount moving between you. */
export interface SettlementPayment {
  memberId: number;
  amount: number;
}

export function settlementBatchForMember(
  transfers: TransferBatch[],
  memberId: number,
): TransferBatch | null {
  return transfers.find((transfer) => transfer.src === memberId) ?? null;
}

export function outgoingSettlementPayments(batch: TransferBatch): SettlementPayment[] {
  return batch.dests.map((destination) => ({
    memberId: destination.id,
    amount: destination.amount,
  }));
}

export function incomingSettlementPaymentsForMember(
  transfers: TransferBatch[],
  memberId: number,
): SettlementPayment[] {
  return transfers.flatMap((transfer) =>
    transfer.dests
      .filter((destination) => destination.id === memberId)
      .map((destination) => ({ memberId: transfer.src, amount: destination.amount })),
  );
}
