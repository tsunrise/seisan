import type { TransferBatch } from "../projectTypes";

export interface IncomingSettlementPayment {
  memberId: number;
  amount: number;
}

export function settlementBatchForMember(
  transfers: TransferBatch[],
  memberId: number,
): TransferBatch | null {
  return transfers.find((transfer) => transfer.src === memberId) ?? null;
}

export function incomingSettlementPaymentsForMember(
  transfers: TransferBatch[],
  memberId: number,
): IncomingSettlementPayment[] {
  return transfers.flatMap((transfer) =>
    transfer.dests
      .filter((destination) => destination.id === memberId)
      .map((destination) => ({ memberId: transfer.src, amount: destination.amount })),
  );
}
