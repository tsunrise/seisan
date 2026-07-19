import { describe, expect, it } from "vitest";

import {
  memberConfigDraft,
  memberConfigDraftIsValid,
  memberConfigFromDraft,
  representedGroupCopy,
} from "../src/memberConfig";

describe("member config UI helpers", () => {
  it("builds editable drafts from existing config", () => {
    expect(memberConfigDraft({ size: 3, paymentMethod: "venmo: alice" })).toEqual({
      paymentMethod: "venmo: alice",
      representsMultiplePeople: true,
      size: "3",
    });
    expect(memberConfigDraft()).toEqual({
      paymentMethod: "",
      representsMultiplePeople: false,
      size: "2",
    });
  });

  it("trims transfer methods and omits unchecked size metadata", () => {
    expect(
      memberConfigFromDraft({
        paymentMethod: "  zelle: alice@example.com  ",
        representsMultiplePeople: false,
        size: "9",
      }),
    ).toEqual({ paymentMethod: "zelle: alice@example.com" });
  });

  it("accepts whole represented group sizes of at least two", () => {
    const valid = {
      paymentMethod: "",
      representsMultiplePeople: true,
      size: "4",
    };
    expect(memberConfigFromDraft(valid)).toEqual({ size: 4 });
    expect(memberConfigDraftIsValid(valid)).toBe(true);

    for (const size of ["", "1", "2.5", "9007199254740992"]) {
      expect(memberConfigFromDraft({ ...valid, size })).toBeNull();
    }
  });

  it("can omit payment methods for owner-created placeholder members", () => {
    expect(
      memberConfigFromDraft(
        {
          paymentMethod: "not saved",
          representsMultiplePeople: true,
          size: "2",
        },
        { includePaymentMethod: false },
      ),
    ).toEqual({ size: 2 });
  });

  it("uses actor-aware copy for represented groups", () => {
    expect(representedGroupCopy(true)).toEqual({
      checkboxLabel: "I represent multiple people",
      sizeLabel: "Number of people represented",
      helperText:
        "Include yourself in this total. The people you represent should not join this project independently.",
    });
    expect(representedGroupCopy(false)).toEqual({
      checkboxLabel: "This member represents multiple people",
      sizeLabel: "Number of people this member represents",
      helperText:
        "Include this member in the total. The people this member represents should not join this project independently.",
    });
  });
});
