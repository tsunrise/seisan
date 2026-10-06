import AddIcon from "@mui/icons-material/Add";
import PersonAddAltIcon from "@mui/icons-material/PersonAddAlt";
import { Box, Button, Stack, TextField } from "@mui/material";
import type { FormEvent } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type * as api from "../../api";
import { getApiErrorMessage } from "../../api/errorMessages";
import { InlineAlert } from "../../components/InlineAlert";
import {
  LinkedBlockList,
  LinkedBlockRemoveButton,
  LinkedBlockVerb,
} from "../../components/LinkedBlockForm";
import { MoneyTable } from "../../components/MoneyTable";
import { PanelFrame } from "../../components/PanelFrame";
import {
  categoryIdForRecord,
  orderedCategoryOptions,
  OTHERS_CATEGORY,
  OTHERS_CATEGORY_ID,
} from "../../domain/categories";
import { activeMembers, deriveDelta, sumMoney } from "../../domain";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import type { SplitMode } from "../../types";
import { ExpenseCategoryField } from "./ExpenseCategoryField";
import {
  availablePayerMembers,
  customAmountInputs,
  expenseLiability,
  expensePayerDrafts,
  parseExpensePayers,
  previewExpensePayers,
  type ExpensePayerDraft,
} from "./expenseForm";
import { ExpenseSplitSection } from "./ExpenseSplitSection";
import { MemberAutocomplete } from "./MemberAutocomplete";
import type { RecordComposerProps } from "./types";
import { useExpenseCategoryClassification } from "./useExpenseCategoryClassification";

/**
 * Expense form with the sentence grammar
 * `For <expense> | Categorized as <category> | , <payer> paid <amount> (| and <payer> paid <amount>)*`
 * followed by the liability split.
 */
export function ExpenseComposer({
  project,
  currentMember,
  categories,
  initialDescription,
  title,
  backTo,
  submitLabel,
  submittingLabel,
  onSubmit,
  onBack,
  footer,
}: RecordComposerProps<"expense"> & { categories: api.Category[] }) {
  const { showError } = useAppSnackbar();
  const members = useMemo(() => activeMembers(project.members), [project.members]);
  const initialPayers = useMemo<ExpensePayerDraft[]>(
    () =>
      initialDescription
        ? expensePayerDrafts(initialDescription.paid)
        : [{ key: 0, memberId: currentMember.id, amount: "" }],
    [currentMember.id, initialDescription],
  );
  const nextPayerKey = useRef(initialPayers.length);
  const [name, setName] = useState(initialDescription?.name ?? "");
  const [payers, setPayers] = useState(initialPayers);
  const [splitMode, setSplitMode] = useState<SplitMode>(initialDescription ? "custom" : "equal");
  const [selectedIds, setSelectedIds] = useState(() =>
    initialDescription
      ? Object.keys(initialDescription.liability).map(Number)
      : members.map((member) => member.id),
  );
  const [ratios, setRatios] = useState<Record<number, string>>({});
  const [customAmounts, setCustomAmounts] = useState<Record<number, string>>(() =>
    initialDescription ? customAmountInputs(initialDescription.liability) : {},
  );
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const nameRef = useRef(name);
  useLayoutEffect(() => {
    nameRef.current = name;
  }, [name]);

  const categoryClassification = useExpenseCategoryClassification(
    name,
    initialDescription ? (initialDescription.categoryId ?? OTHERS_CATEGORY_ID) : undefined,
  );
  const categoryOptions = useMemo(() => {
    const ordered = orderedCategoryOptions(categories, categoryClassification.state.candidates);
    return [...ordered.suggested, ...ordered.remaining];
  }, [categories, categoryClassification.state.candidates]);
  const selectedCategory =
    categoryOptions.find((category) => category.id === categoryClassification.state.categoryId) ??
    OTHERS_CATEGORY;
  const categoryIsPending =
    name.trim().length > 0 && !categoryClassification.classificationIsCurrent;

  const parsedPaid = parseExpensePayers(payers);
  const paid = parsedPaid ?? previewExpensePayers(payers);
  const total = sumMoney(paid);
  const liability = expenseLiability({
    total,
    splitMode,
    members,
    selectedIds,
    ratios,
    customAmounts,
  });
  const description: api.WritableRecordDescription = {
    type: "expense",
    name: name || "Expense",
    paid,
    liability,
  };
  const delta = deriveDelta(description);
  const canAddPayer =
    payers.every((payer) => payer.memberId !== null) && payers.length < members.length;

  function updatePayer(
    key: number,
    patch: Partial<Pick<ExpensePayerDraft, "memberId" | "amount">>,
  ) {
    setPayers((current) =>
      current.map((payer) => (payer.key === key ? { ...payer, ...patch } : payer)),
    );
  }

  function addPayer() {
    const key = nextPayerKey.current;
    nextPayerKey.current += 1;
    setPayers((current) => [...current, { key, memberId: null, amount: "" }]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (
      !name.trim() ||
      !parsedPaid ||
      total <= 0 ||
      selectedIds.length === 0 ||
      sumMoney(liability) !== total
    ) {
      setError("Check the amount and split.");
      return;
    }
    const submittedName = name;
    setPosting(true);
    try {
      // Never attach a category classified for different text than what is being posted.
      const classification = await categoryClassification.ensureClassification(submittedName);
      if (classification.stale || nameRef.current !== submittedName) {
        return;
      }
      const categoryId = categoryIdForRecord(classification.selectedCategoryId);
      const submittedDescription: api.WritableRecordDescription = {
        ...description,
        ...(categoryId ? { categoryId } : {}),
      };
      await onSubmit({
        description: submittedDescription,
        delta: deriveDelta(submittedDescription),
      });
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setPosting(false);
    }
  }

  return (
    <PanelFrame title={title} backTo={backTo} onBack={onBack}>
      <Stack component="form" spacing={2} onSubmit={submit}>
        <LinkedBlockList
          connector={(index) => {
            if (index === 1) {
              return "Categorized as";
            }
            return index === 2 ? "," : "and";
          }}
        >
          <Stack key="expense" direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <LinkedBlockVerb>For</LinkedBlockVerb>
            <Box sx={{ flex: "1 1 auto", minWidth: 0 }}>
              <TextField
                fullWidth
                label="Expense"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={categoryClassification.classifyOnBlur}
                required
              />
            </Box>
          </Stack>
          <ExpenseCategoryField
            key="category"
            options={categoryOptions}
            value={selectedCategory}
            pending={categoryIsPending}
            onChange={categoryClassification.selectCategory}
          />
          {payers.map((payer, index) => (
            <Box key={payer.key}>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto minmax(88px, 0.62fr) 32px",
                  columnGap: 0.75,
                  alignItems: "center",
                }}
              >
                <MemberAutocomplete
                  label="Payer"
                  options={availablePayerMembers(members, payers, payer.key)}
                  value={members.find((member) => member.id === payer.memberId) ?? null}
                  onChange={(member) => updatePayer(payer.key, { memberId: member?.id ?? null })}
                />
                <LinkedBlockVerb>paid</LinkedBlockVerb>
                <TextField
                  label="Amount"
                  inputMode="decimal"
                  value={payer.amount}
                  onChange={(event) => updatePayer(payer.key, { amount: event.target.value })}
                  placeholder="12.34"
                  required
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                {payers.length > 1 ? (
                  <LinkedBlockRemoveButton
                    label={`Remove payer ${index + 1}`}
                    onClick={() =>
                      setPayers((current) =>
                        current.filter((candidate) => candidate.key !== payer.key),
                      )
                    }
                  />
                ) : (
                  <Box aria-hidden="true" />
                )}
              </Box>
              {index === payers.length - 1 ? (
                <Button
                  type="button"
                  variant="text"
                  startIcon={<PersonAddAltIcon />}
                  disabled={!canAddPayer}
                  onClick={addPayer}
                  sx={{ alignSelf: "flex-start", mt: 0.75, ml: -0.5 }}
                >
                  Add payer
                </Button>
              ) : null}
            </Box>
          ))}
        </LinkedBlockList>
        <ExpenseSplitSection
          members={members}
          splitMode={splitMode}
          selectedIds={selectedIds}
          ratios={ratios}
          customAmounts={customAmounts}
          liability={liability}
          onSplitMode={setSplitMode}
          onSelected={(memberId, selected) =>
            setSelectedIds((ids) =>
              selected
                ? [...ids, memberId].sort((left, right) => left - right)
                : ids.filter((id) => id !== memberId),
            )
          }
          onRatio={(memberId, value) => setRatios((next) => ({ ...next, [memberId]: value }))}
          onCustomAmount={(memberId, value) =>
            setCustomAmounts((next) => ({ ...next, [memberId]: value }))
          }
        />
        <MoneyTable title="Preview" project={project} map={delta} />
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <Button
          type="submit"
          variant="contained"
          startIcon={<AddIcon />}
          disabled={!name.trim() || categoryIsPending || posting}
        >
          {posting ? submittingLabel : submitLabel}
        </Button>
      </Stack>
      {footer}
    </PanelFrame>
  );
}
