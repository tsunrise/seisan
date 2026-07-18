import { describe, expect, it } from "vitest";

import type { ProjectMember, TransferBatch } from "../src/projectTypes";
import {
  availableDestinationMembers,
  parseTransferDestinations,
  prefixMatchingMembers,
  transferBatchTotal,
  transferPrefillFromSearch,
  transferPrefillSearch,
} from "../src/project/transferForm";

const members: ProjectMember[] = [
  { id: 1, name: "Alice", deleted: false },
  { id: 2, name: "Albert", deleted: false },
  { id: 3, name: "Bob", deleted: false },
  { id: 4, name: "Malice", deleted: false },
  { id: 5, name: "Deleted", deleted: true },
];

describe("multi-recipient transfer UI helpers", () => {
  it("matches member names by case-insensitive prefix", () => {
    expect(prefixMatchingMembers(members, "al").map((member) => member.id)).toEqual([1, 2]);
    expect(prefixMatchingMembers(members, " ALI ").map((member) => member.id)).toEqual([1]);
    expect(prefixMatchingMembers(members, "lice")).toEqual([]);
    expect(prefixMatchingMembers(members, "")).toEqual(members);
  });

  it("excludes the sender and recipients selected in other rows", () => {
    const destinations = [
      { key: 10, memberId: 2, amount: "1.00" },
      { key: 11, memberId: 3, amount: "2.00" },
    ];
    expect(
      availableDestinationMembers(members, 1, destinations, 10).map((member) => member.id),
    ).toEqual([2, 4, 5]);
    expect(
      availableDestinationMembers(members, 1, destinations, 11).map((member) => member.id),
    ).toEqual([3, 4, 5]);
  });

  it("parses positive unique destinations and rejects invalid or unsafe totals", () => {
    expect(
      parseTransferDestinations([
        { key: 1, memberId: 2, amount: "3.00" },
        { key: 2, memberId: 3, amount: "2.50" },
      ]),
    ).toEqual([
      { id: 2, amount: 300 },
      { id: 3, amount: 250 },
    ]);
    expect(
      transferBatchTotal({
        dests: [
          { id: 2, amount: 300 },
          { id: 3, amount: 250 },
        ],
      }),
    ).toBe(550);
    expect(
      parseTransferDestinations([
        { key: 1, memberId: 2, amount: "1.00" },
        { key: 2, memberId: 2, amount: "2.00" },
      ]),
    ).toBeNull();
    expect(parseTransferDestinations([{ key: 1, memberId: 2, amount: "0" }])).toBeNull();
    expect(parseTransferDestinations([{ key: 1, memberId: null, amount: "1.00" }])).toBeNull();
    expect(
      parseTransferDestinations([
        { key: 1, memberId: 2, amount: "90071992547409.91" },
        { key: 2, memberId: 3, amount: "0.01" },
      ]),
    ).toBeNull();
  });

  it("round-trips a transfer batch leg through transfer prefill search params", () => {
    const transfer: TransferBatch = {
      src: 1,
      dests: [
        { id: 2, amount: 1234 },
        { id: 3, amount: 50 },
      ],
    };
    const search = transferPrefillSearch(transfer, 2);
    expect(search).toBe("mode=transfer&from=1&to=2&amount=12.34");
    expect(transferPrefillFromSearch(new URLSearchParams(search), members)).toEqual({
      from: 1,
      to: 2,
      amount: "12.34",
    });
    expect(
      transferPrefillFromSearch(
        new URLSearchParams("mode=transfer&from=1&to=5&amount=1.00"),
        members,
      ),
    ).toBeNull();
    expect(
      transferPrefillFromSearch(
        new URLSearchParams("mode=transfer&from=1&to=1&amount=1.00"),
        members,
      ),
    ).toBeNull();
  });
});
