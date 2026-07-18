import AddIcon from "@mui/icons-material/Add";
import {
  Button,
  CircularProgress,
  ListSubheader,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { FormEvent } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

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
  type CategoryOption,
} from "../categories";
import {
  activeMembers,
  allocateEqualByMemberSize,
  allocateRatio,
  deriveDelta,
  memberSize,
  parseCents,
} from "../domain";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { useExpenseCategoryClassification } from "../hooks/useExpenseCategoryClassification";
import type { SplitMode } from "../types";
import { MemberSplitRow } from "./MemberSplitRow";
import { RecordFormBridge } from "./RecordFormBridge";
import { RecordSentenceField, RecordSentenceRow } from "./RecordSentenceRow";

export function ExpenseComposer({
  project,
  currentMember,
  categories,
  onPosted,
  onBack,
}: {
  project: api.Project;
  currentMember: api.ProjectMember;
  categories: api.Category[];
  onPosted: () => void;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { showError, showSuccess } = useAppSnackbar();
  const members = useMemo(() => activeMembers(project.members), [project.members]);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(currentMember.id);
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [selectedIds, setSelectedIds] = useState(() => members.map((member) => member.id));
  const [ratios, setRatios] = useState<Record<number, string>>({});
  const [customAmounts, setCustomAmounts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const nameRef = useRef(name);
  useLayoutEffect(() => {
    nameRef.current = name;
  }, [name]);
  const categoryClassification = useExpenseCategoryClassification(name);
  const total = parseCents(amount);
  const liability = useMemo(() => {
    if (total === null) {
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
  }, [customAmounts, members, ratios, selectedIds, splitMode, total]);
  const paid = total === null ? {} : { [String(paidBy)]: total };
  const description: api.RecordDescription = {
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (
      !name.trim() ||
      total === null ||
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
      const submittedDescription: api.RecordDescription = {
        ...description,
        ...(categoryId ? { categoryId } : {}),
      };
      await api.appendRecord(project.id, {
        description: submittedDescription,
        delta: deriveDelta(submittedDescription),
      });
      showSuccess("Record posted.");
      onPosted();
      navigate(`/project/${project.id}`);
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setPosting(false);
    }
  }

  return (
    <PanelFrame
      title="New group spend"
      backTo={`/project/${project.id}/records/new`}
      onBack={onBack}
    >
      <Stack component="form" spacing={2} onSubmit={submit}>
        <RecordSentenceRow>
          <RecordSentenceField minWidth={148}>
            <TextField
              select
              label="Payer"
              value={String(paidBy)}
              onChange={(event) => setPaidBy(Number(event.target.value))}
            >
              {members.map((member) => (
                <MenuItem key={member.id} value={String(member.id)}>
                  {member.name}
                </MenuItem>
              ))}
            </TextField>
          </RecordSentenceField>
          <RecordFormBridge>paid</RecordFormBridge>
          <RecordSentenceField minWidth={120}>
            <TextField
              label="Amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="12.34"
              required
            />
          </RecordSentenceField>
          <RecordFormBridge>for</RecordFormBridge>
          <RecordSentenceField grow minWidth={180}>
            <TextField
              label="Expense"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={categoryClassification.classifyOnBlur}
              required
            />
          </RecordSentenceField>
        </RecordSentenceRow>
        <TextField
          select
          fullWidth
          label="Category"
          value={categoryClassification.state.categoryId}
          onChange={(event) => categoryClassification.selectCategory(event.target.value)}
          sx={
            categoryIsPending
              ? { "& .MuiSelect-icon": { right: 12, top: "calc(50% - 9px)" } }
              : undefined
          }
          slotProps={{
            select: {
              IconComponent: categoryIsPending ? CategoryLoadingIcon : undefined,
              onOpen: () => setShowAllCategories(false),
              renderValue: () => <CategoryOptionContent category={selectedCategory} />,
            },
          }}
        >
          {categoryOptions.suggested.map((category) => (
            <MenuItem key={category.id} value={category.id}>
              <CategoryOptionContent category={category} />
            </MenuItem>
          ))}
          {!showAllCategories && (
            <ListSubheader
              disableSticky
              sx={{
                borderTop: categoryOptions.suggested.length > 0 ? "1px solid" : undefined,
                borderColor: "divider",
                mt: categoryOptions.suggested.length > 0 ? 0.5 : 0,
                p: 0,
              }}
            >
              <Button
                fullWidth
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowAllCategories(true);
                }}
                sx={{
                  justifyContent: "flex-start",
                  minHeight: 40,
                  px: 2,
                  textTransform: "none",
                }}
              >
                Show all categories
              </Button>
            </ListSubheader>
          )}
          {categoryOptions.remaining.map((category, index) => (
            <MenuItem
              key={category.id}
              value={category.id}
              sx={{
                display: showAllCategories ? "flex" : "none",
                ...(index === 0 && categoryOptions.suggested.length > 0
                  ? { borderTop: "1px solid", borderColor: "divider", mt: 0.5 }
                  : {}),
              }}
            >
              <CategoryOptionContent category={category} />
            </MenuItem>
          ))}
        </TextField>
        <Stack spacing={1.25}>
          <Stack sx={{ alignItems: "stretch", gap: 1 }}>
            <Typography variant="h3" sx={{ whiteSpace: "nowrap" }}>
              Shared with
            </Typography>
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
          </Stack>
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
        </Stack>
        <MoneyTable title="Preview" project={project} map={delta} />
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <Button
          type="submit"
          variant="contained"
          startIcon={<AddIcon />}
          disabled={!name.trim() || categoryIsPending || posting}
        >
          {posting ? "Posting…" : "Post"}
        </Button>
      </Stack>
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

function CategoryLoadingIcon({ className }: { className?: string }) {
  return (
    <CircularProgress
      aria-label="Classifying category"
      className={className}
      color="inherit"
      size={18}
      thickness={5}
    />
  );
}
