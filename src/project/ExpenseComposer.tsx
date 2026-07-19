import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import PersonAddAltIcon from "@mui/icons-material/PersonAddAlt";
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { FormEvent, ReactNode } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { InlineAlert } from "../components/InlineAlert";
import { MoneyTable } from "../components/MoneyTable";
import { NamedIcon } from "../components/NamedIcon";
import { PanelFrame } from "../components/PanelFrame";
import {
  categoryIdForRecord,
  orderedCategoryOptions,
  OTHERS_CATEGORY,
  OTHERS_CATEGORY_ID,
  prefixMatchingCategories,
  type CategoryOption,
} from "../categories";
import {
  activeMembers,
  allocateEqualByMemberSize,
  allocateRatio,
  deriveDelta,
  memberSize,
  parseCents,
  sumMoney,
} from "../domain";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { useExpenseCategoryClassification } from "../hooks/useExpenseCategoryClassification";
import { ledgerColors } from "../theme";
import type { SplitMode } from "../types";
import { LinkedBlockList, LinkedBlockVerb } from "./LinkedBlockForm";
import { prefixMatchingMembers } from "./memberSearch";
import { MemberSplitRow } from "./MemberSplitRow";
import {
  availablePayerMembers,
  centsInput,
  expensePayerDrafts,
  parseExpensePayers,
  previewExpensePayers,
  type ExpensePayerDraft,
} from "./expenseForm";

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
}: {
  project: api.Project;
  currentMember: api.ProjectMember;
  categories: api.Category[];
  initialDescription?: Extract<api.WritableRecordDescription, { type: "expense" }>;
  title: string;
  backTo: string;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (input: {
    description: api.WritableRecordDescription;
    delta: api.MoneyByMemberId;
  }) => Promise<void>;
  onBack?: () => void;
  footer?: ReactNode;
}) {
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
    initialDescription
      ? Object.fromEntries(
          Object.entries(initialDescription.liability).map(([memberId, amount]) => [
            Number(memberId),
            centsInput(amount),
          ]),
        )
      : {},
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
  const parsedPaid = parseExpensePayers(payers);
  const paid = parsedPaid ?? previewExpensePayers(payers);
  const total = sumMoney(paid);
  const liability = (() => {
    if (total <= 0) {
      return {};
    }
    if (splitMode === "equal") {
      return allocateEqualByMemberSize(total, members, selectedIds);
    }
    if (splitMode === "ratio") {
      return allocateRatio(
        total,
        selectedIds.map((memberId) => ({
          memberId,
          ratio: Number(ratios[memberId] || memberSizeForId(members, memberId)),
        })),
      );
    }
    const custom: api.MoneyByMemberId = {};
    for (const memberId of selectedIds) {
      const parsed = parseCents(customAmounts[memberId] ?? "");
      if (parsed !== null) {
        custom[String(memberId)] = parsed;
      }
    }
    return custom;
  })();
  const description: api.WritableRecordDescription = {
    type: "expense",
    name: name || "Expense",
    paid,
    liability,
  };
  const delta = deriveDelta(description);
  const customTotal = Object.values(liability).reduce((sum, value) => sum + value, 0);
  const categoryOptions = useMemo(
    () => orderedCategoryOptions(categories, categoryClassification.state.candidates),
    [categories, categoryClassification.state.candidates],
  );
  const allCategoryOptions = [...categoryOptions.suggested, ...categoryOptions.remaining];
  const selectedCategory =
    allCategoryOptions.find(
      (category) => category.id === categoryClassification.state.categoryId,
    ) ?? OTHERS_CATEGORY;
  const categoryIsPending =
    name.trim().length > 0 && !categoryClassification.classificationIsCurrent;
  const canAddPayer =
    payers.every((payer) => payer.memberId !== null) && payers.length < members.length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (
      !name.trim() ||
      !parsedPaid ||
      total <= 0 ||
      selectedIds.length === 0 ||
      customTotal !== total
    ) {
      setError("Check the amount and split.");
      return;
    }
    const submittedName = name;
    setPosting(true);
    try {
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
          <Autocomplete
            key="category"
            autoHighlight
            disableClearable
            openOnFocus
            options={allCategoryOptions}
            value={selectedCategory}
            getOptionLabel={(category) => category.name}
            isOptionEqualToValue={(left, right) => left.id === right.id}
            filterOptions={(available, state) =>
              prefixMatchingCategories(available, state.inputValue)
            }
            onChange={(_event, category) => categoryClassification.selectCategory(category.id)}
            renderOption={(props, category) => {
              const { key, ...optionProps } = props;
              return (
                <Box component="li" key={key} {...optionProps}>
                  <CategoryOptionContent category={category} />
                </Box>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Category"
                slotProps={{
                  inputLabel: params.slotProps.inputLabel,
                  input: {
                    ...params.slotProps.input,
                    startAdornment: (
                      <>
                        <InputAdornment position="start">
                          <NamedIcon
                            name={selectedCategory.icon}
                            sx={{ color: "text.secondary", fontSize: 20 }}
                          />
                        </InputAdornment>
                        {params.slotProps.input.startAdornment}
                      </>
                    ),
                    endAdornment: (
                      <>
                        {categoryIsPending ? (
                          <CircularProgress
                            aria-label="Classifying category"
                            color="inherit"
                            size={18}
                            thickness={5}
                          />
                        ) : null}
                        {params.slotProps.input.endAdornment}
                      </>
                    ),
                  },
                  htmlInput: params.slotProps.htmlInput,
                }}
              />
            )}
          />
          {payers.map((payer, index) => {
            const payerOptions = availablePayerMembers(members, payers, payer.key);
            const selectedPayer = members.find((member) => member.id === payer.memberId) ?? null;
            return (
              <Box key={payer.key}>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto minmax(88px, 0.62fr) 32px",
                    columnGap: 0.75,
                    alignItems: "center",
                  }}
                >
                  <Autocomplete
                    autoHighlight
                    disableClearable={selectedPayer !== null}
                    openOnFocus
                    options={payerOptions}
                    value={selectedPayer}
                    getOptionLabel={(member) => member.name}
                    isOptionEqualToValue={(left, right) => left.id === right.id}
                    filterOptions={(available, state) =>
                      prefixMatchingMembers(available, state.inputValue)
                    }
                    onChange={(_event, member) =>
                      setPayers((current) =>
                        current.map((candidate) =>
                          candidate.key === payer.key
                            ? { ...candidate, memberId: member?.id ?? null }
                            : candidate,
                        ),
                      )
                    }
                    renderInput={(params) => <TextField {...params} label="Payer" required />}
                  />
                  <LinkedBlockVerb>paid</LinkedBlockVerb>
                  <TextField
                    label="Amount"
                    inputMode="decimal"
                    value={payer.amount}
                    onChange={(event) =>
                      setPayers((current) =>
                        current.map((candidate) =>
                          candidate.key === payer.key
                            ? { ...candidate, amount: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                    placeholder="12.34"
                    required
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  {payers.length > 1 ? (
                    <IconButton
                      type="button"
                      size="small"
                      aria-label={`Remove payer ${index + 1}`}
                      onClick={() =>
                        setPayers((current) =>
                          current.filter((candidate) => candidate.key !== payer.key),
                        )
                      }
                      sx={{
                        width: 32,
                        height: 36,
                        border: 0,
                        bgcolor: "transparent",
                        color: "text.secondary",
                        "&:hover": { bgcolor: "action.hover", color: "text.primary" },
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
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
                    onClick={() => {
                      const key = nextPayerKey.current;
                      nextPayerKey.current += 1;
                      setPayers((current) => [...current, { key, memberId: null, amount: "" }]);
                    }}
                    sx={{ alignSelf: "flex-start", mt: 0.75, ml: -0.5 }}
                  >
                    Add payer
                  </Button>
                ) : null}
              </Box>
            );
          })}
        </LinkedBlockList>
        <Stack spacing={1}>
          <LinkedBlockVerb>This expense should be paid by</LinkedBlockVerb>
          <LinkedBlockList>
            <Stack key="sharing" spacing={1.25}>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={splitMode}
                onChange={(_, next: SplitMode | null) => {
                  if (next) {
                    setSplitMode(next);
                  }
                }}
                sx={{
                  width: "100%",
                  "& .MuiToggleButton-root": {
                    flex: "1 1 0",
                    minWidth: 0,
                    minHeight: 36,
                    px: 1.5,
                  },
                }}
              >
                <ToggleButton value="equal">Equal</ToggleButton>
                <ToggleButton value="ratio">Ratio</ToggleButton>
                <ToggleButton value="custom">Custom</ToggleButton>
              </ToggleButtonGroup>
              <Stack spacing={0.25}>
                {members.map((member) => (
                  <MemberSplitRow
                    key={member.id}
                    member={member}
                    selected={selectedIds.includes(member.id)}
                    splitMode={splitMode}
                    value={
                      splitMode === "ratio"
                        ? (ratios[member.id] ?? String(memberSize(member)))
                        : (customAmounts[member.id] ?? "")
                    }
                    amount={liability[String(member.id)] ?? 0}
                    onSelected={(selected) =>
                      setSelectedIds((ids) =>
                        selected
                          ? [...ids, member.id].sort((left, right) => left - right)
                          : ids.filter((id) => id !== member.id),
                      )
                    }
                    onValue={(value) =>
                      splitMode === "ratio"
                        ? setRatios((next) => ({ ...next, [member.id]: value }))
                        : setCustomAmounts((next) => ({ ...next, [member.id]: value }))
                    }
                  />
                ))}
              </Stack>
              <Typography sx={{ color: ledgerColors.muted, fontSize: 12.5, lineHeight: 1.4 }}>
                You can add additional members in project settings or edit this post later when more
                members join.
              </Typography>
            </Stack>
          </LinkedBlockList>
        </Stack>
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

function memberSizeForId(members: api.ProjectMemberFull[], memberId: number): number {
  const member = members.find((candidate) => candidate.id === memberId);
  return member ? memberSize(member) : 1;
}

function CategoryOptionContent({ category }: { category: CategoryOption }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}>
      <NamedIcon name={category.icon} sx={{ color: "text.secondary", fontSize: 20 }} />
      <Typography component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {category.name}
      </Typography>
    </Stack>
  );
}
