import { describe, expect, it } from "vitest";

import type { ProjectMemberFull } from "../src/api/types";
import { formatCentsInput } from "../src/domain";
import { customAmountInputs, expenseLiability } from "../src/project/composer/expenseForm";

const members: ProjectMemberFull[] = [
  { id: 1, name: "Alice", deleted: false },
  { id: 2, name: "Bob", deleted: false, config: { size: 2 } },
  { id: 3, name: "Carol", deleted: false },
];

describe("expense composer helpers", () => {
  it("formats cents as editable decimal inputs", () => {
    expect(formatCentsInput(0)).toBe("0.00");
    expect(formatCentsInput(5)).toBe("0.05");
    expect(formatCentsInput(1230)).toBe("12.30");
    expect(customAmountInputs({ "1": 250, "3": 1 })).toEqual({ 1: "2.50", 3: "0.01" });
  });

  it("weights equal splits by represented member size", () => {
    expect(
      expenseLiability({
        total: 400,
        splitMode: "equal",
        members,
        selectedIds: [1, 2, 3],
        ratios: {},
        customAmounts: {},
      }),
    ).toEqual({ "1": 100, "2": 200, "3": 100 });
  });

  it("defaults blank ratios to represented member size", () => {
    expect(
      expenseLiability({
        total: 600,
        splitMode: "ratio",
        members,
        selectedIds: [1, 2],
        ratios: { 1: "4" },
        customAmounts: {},
      }),
    ).toEqual({ "1": 400, "2": 200 });
  });

  it("takes custom amounts as entered for selected members only", () => {
    expect(
      expenseLiability({
        total: 1000,
        splitMode: "custom",
        members,
        selectedIds: [1, 3],
        ratios: {},
        customAmounts: { 1: "3.00", 2: "9.00", 3: "nope" },
      }),
    ).toEqual({ "1": 300 });
  });

  it("allocates nothing until a positive total is paid", () => {
    expect(
      expenseLiability({
        total: 0,
        splitMode: "equal",
        members,
        selectedIds: [1, 2, 3],
        ratios: {},
        customAmounts: {},
      }),
    ).toEqual({});
  });
});
