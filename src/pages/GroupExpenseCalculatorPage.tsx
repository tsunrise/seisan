import AddIcon from "@mui/icons-material/Add";
import AltRouteOutlinedIcon from "@mui/icons-material/AltRouteOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CalculateOutlinedIcon from "@mui/icons-material/CalculateOutlined";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import MoneyOffOutlinedIcon from "@mui/icons-material/MoneyOffOutlined";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import {
  activeCalculatorPayerMemberIds,
  addCalculatorLiabilityMember,
  addCalculatorPayer,
  calculateGroupExpense,
  clearCalculatorDraft,
  commitCalculatorPayerName,
  createInitialCalculatorDraft,
  deleteCalculatorLiabilityMember,
  loadCalculatorDraft,
  MAX_CALCULATOR_MEMBER_NAME_LENGTH,
  previewCalculatorAllocation,
  removeCalculatorPayer,
  renameCalculatorLiabilityMember,
  scheduleCalculatorDraftSave,
  setCalculatorMemberSelected,
  setCalculatorSplitMode,
  updateCalculatorCustomAmount,
  updateCalculatorPayer,
  updateCalculatorRatio,
  type CalculatorDraft,
  type CalculatorDraftStorage,
  type CalculatorIssue,
  type CalculatorPlan,
} from "../calculator/groupExpenseCalculator";
import { BrandLink } from "../components/BrandLink";
import { InlineAlert } from "../components/InlineAlert";
import { paperFrameSx } from "../components/styles";
import { formatCents } from "../domain";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { LinkedBlockList, LinkedBlockVerb } from "../project/LinkedBlockForm";
import { ledgerColors, ledgerFonts } from "../theme";
import type { SplitMode } from "../types";

const PAGE_TITLE = "Seisan: Free Group Expense Calculator, See Who Pays Whom";
const PAGE_DESCRIPTION =
  "Split a group expense equally, by ratio, or with custom amounts and get a clear settlement plan. Free, private to your browser, and no sign-up required.";
const SOFTWARE_APPLICATION_ID = "seisan-calculator-structured-data";

interface InitialCalculatorState {
  draft: CalculatorDraft;
  storage: CalculatorDraftStorage | null;
  storageWarning: boolean;
}

type LiabilityNameEditor =
  | { kind: "member"; memberId: number; value: string; issue: string | null }
  | { kind: "new"; value: string; issue: string | null };

function initialCalculatorState(): InitialCalculatorState {
  try {
    const storage = window.localStorage;
    return { draft: loadCalculatorDraft(storage), storage, storageWarning: false };
  } catch {
    return {
      draft: createInitialCalculatorDraft(),
      storage: null,
      storageWarning: true,
    };
  }
}

export function GroupExpenseCalculatorPage() {
  const [initialState] = useState(initialCalculatorState);
  const session = useCurrentUser({ required: false });
  const [draft, setDraft] = useState(initialState.draft);
  const [issues, setIssues] = useState<CalculatorIssue[]>([]);
  const [plan, setPlan] = useState<CalculatorPlan | null>(null);
  const [storageWarning, setStorageWarning] = useState(initialState.storageWarning);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [liabilityNameEditor, setLiabilityNameEditor] = useState<LiabilityNameEditor | null>(null);

  useDocumentTitle(PAGE_TITLE);
  useCalculatorMetadata();

  useEffect(() => {
    const storage = initialState.storage;
    if (!storage) {
      return;
    }
    return scheduleCalculatorDraftSave(storage, draft, () => setStorageWarning(true));
  }, [draft, initialState.storage]);

  const payerMemberIds = activeCalculatorPayerMemberIds(draft);
  const selectedMemberIds = useMemo(() => new Set(draft.selectedMemberIds), [draft]);
  const allocationPreview = useMemo(() => previewCalculatorAllocation(draft), [draft]);

  function editDraft(update: CalculatorDraft | ((current: CalculatorDraft) => CalculatorDraft)) {
    setDraft((current) => (typeof update === "function" ? update(current) : update));
    setPlan(null);
    setIssues([]);
  }

  function editWithoutDraftChange() {
    setPlan(null);
    setIssues([]);
  }

  function commitPayerName(key: number) {
    const committed = commitCalculatorPayerName(draft, key);
    setDraft(committed.draft);
    setPlan(null);
    setIssues((current) => [
      ...current.filter((issue) => !(issue.field === "payerName" && issue.key === key)),
      ...(committed.issue ? [committed.issue] : []),
    ]);
  }

  function startLiabilityNameEdit(memberId: number, value: string) {
    if (liabilityNameEditor) {
      return;
    }
    editWithoutDraftChange();
    setLiabilityNameEditor({ kind: "member", memberId, value, issue: null });
  }

  function startNewLiabilityMember() {
    if (liabilityNameEditor) {
      return;
    }
    editWithoutDraftChange();
    setLiabilityNameEditor({ kind: "new", value: "", issue: null });
  }

  function updateLiabilityNameEditor(value: string) {
    editWithoutDraftChange();
    setLiabilityNameEditor((current) => (current ? { ...current, value, issue: null } : current));
  }

  function cancelLiabilityNameEditor() {
    editWithoutDraftChange();
    setLiabilityNameEditor(null);
  }

  function confirmLiabilityNameEditor() {
    if (!liabilityNameEditor) {
      return;
    }
    const result =
      liabilityNameEditor.kind === "new"
        ? addCalculatorLiabilityMember(draft, liabilityNameEditor.value)
        : renameCalculatorLiabilityMember(
            draft,
            liabilityNameEditor.memberId,
            liabilityNameEditor.value,
          );
    if (result.issue) {
      setLiabilityNameEditor({ ...liabilityNameEditor, issue: result.issue.message });
      return;
    }
    editDraft(result.draft);
    setLiabilityNameEditor(null);
  }

  function calculate(event: FormEvent) {
    event.preventDefault();
    if (liabilityNameEditor) {
      return;
    }
    const result = calculateGroupExpense(draft);
    setDraft(result.draft);
    setIssues(result.issues);
    setPlan(result.plan);
  }

  function confirmClear() {
    const storage = initialState.storage;
    if (storage) {
      try {
        clearCalculatorDraft(storage);
      } catch {
        setStorageWarning(true);
      }
    }
    setDraft(createInitialCalculatorDraft());
    setIssues([]);
    setPlan(null);
    setLiabilityNameEditor(null);
    setClearDialogOpen(false);
  }

  const formIssues = issues.filter((issue) => issue.field === "form");
  const memberCount = draft.members.length;

  return (
    <Box sx={{ minHeight: "100svh" }}>
      <Box
        component="header"
        sx={{
          borderBottom: `1px solid ${ledgerColors.line}`,
          bgcolor: "rgba(247, 246, 241, 0.94)",
        }}
      >
        <Stack
          direction="row"
          sx={{
            width: "min(1180px, 100%)",
            minHeight: 68,
            mx: "auto",
            px: { xs: 2, sm: 3 },
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
          }}
        >
          <BrandLink />
          {session.status === "ready" && session.data ? (
            <Button component={Link} to="/projects" variant="outlined">
              My Projects
            </Button>
          ) : session.status !== "loading" ? (
            <Button component={Link} to="/login?returnTo=%2F" variant="outlined">
              Sign in
            </Button>
          ) : (
            <Box sx={{ width: 94, height: 42 }} aria-hidden="true" />
          )}
        </Stack>
      </Box>

      <Box component="main">
        <Box
          component="section"
          aria-labelledby="calculator-heading"
          sx={{
            width: "min(1180px, 100%)",
            mx: "auto",
            px: { xs: 2, sm: 3 },
            pt: { xs: 5, md: 7 },
            pb: { xs: 6, md: 9 },
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(330px, 0.82fr) minmax(560px, 1.18fr)" },
            gap: { xs: 4, md: 6, lg: 8 },
            alignItems: "start",
          }}
        >
          <Stack spacing={2.5} sx={{ pt: { md: 3 }, position: { md: "sticky" }, top: { md: 28 } }}>
            <Typography
              id="calculator-heading"
              component="h1"
              sx={{
                maxWidth: 500,
                fontFamily: ledgerFonts.serif,
                fontSize: { xs: 45, sm: 52, md: 56 },
                fontWeight: 700,
                letterSpacing: "-0.035em",
                lineHeight: 0.98,
              }}
            >
              Group Expense Calculator
            </Typography>
            <Typography
              sx={{
                maxWidth: 430,
                color: "text.secondary",
                fontSize: { xs: 18, md: 20 },
                lineHeight: 1.55,
              }}
            >
              Figure out who should pay who easily. No login required.
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", color: "text.secondary" }}
            >
              <LockOutlinedIcon sx={{ fontSize: 17 }} />
              <Typography sx={{ fontSize: 13.5 }}>
                The calculator runs entirely in your browser.
              </Typography>
            </Stack>
          </Stack>

          <Stack spacing={2}>
            <Paper
              component="form"
              square
              onSubmit={calculate}
              noValidate
              sx={{
                ...paperFrameSx,
                p: { xs: 2, sm: 3 },
                boxShadow: `0 18px 54px ${ledgerColors.shadowInk}`,
              }}
            >
              <Stack spacing={3}>
                <Box>
                  <Typography variant="h2" sx={{ fontFamily: ledgerFonts.serif, mb: 0.5 }}>
                    Who paid?
                  </Typography>
                  <Typography color="text.secondary" sx={{ fontSize: 14 }}>
                    Add every person who covered part of the total.
                  </Typography>
                </Box>

                <LinkedBlockList>
                  {draft.payers.map((payer) => {
                    const nameIssue = issueForPayer(issues, payer.key, "payerName");
                    const amountIssue = issueForPayer(issues, payer.key, "payerAmount");
                    return (
                      <Box
                        key={payer.key}
                        sx={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto minmax(88px, 0.62fr) 32px",
                          columnGap: 0.75,
                          alignItems: "center",
                        }}
                      >
                        <TextField
                          label="Member name"
                          value={payer.name}
                          error={Boolean(nameIssue)}
                          helperText={nameIssue}
                          onChange={(event) =>
                            editDraft((current) =>
                              updateCalculatorPayer(current, payer.key, {
                                name: event.target.value,
                              }),
                            )
                          }
                          onBlur={() => commitPayerName(payer.key)}
                          slotProps={{
                            htmlInput: { maxLength: MAX_CALCULATOR_MEMBER_NAME_LENGTH + 1 },
                          }}
                        />
                        <LinkedBlockVerb>paid</LinkedBlockVerb>
                        <TextField
                          label="Amount"
                          inputMode="decimal"
                          value={payer.amount}
                          error={Boolean(amountIssue)}
                          helperText={amountIssue}
                          onChange={(event) =>
                            editDraft((current) =>
                              updateCalculatorPayer(current, payer.key, {
                                amount: event.target.value,
                              }),
                            )
                          }
                          slotProps={{
                            input: {
                              startAdornment: <InputAdornment position="start">$</InputAdornment>,
                            },
                          }}
                        />
                        <IconButton
                          type="button"
                          size="small"
                          aria-label={`Remove payer row ${payer.name || payer.key}`}
                          onClick={() =>
                            editDraft((current) => removeCalculatorPayer(current, payer.key))
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
                      </Box>
                    );
                  })}
                </LinkedBlockList>

                <Button
                  type="button"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => editDraft(addCalculatorPayer(draft))}
                  sx={{ alignSelf: "flex-start" }}
                >
                  Add payer
                </Button>

                <Divider />

                <Box>
                  <Typography variant="h2" sx={{ fontFamily: ledgerFonts.serif, mb: 0.5 }}>
                    How should the total be shared?
                  </Typography>
                  <Typography color="text.secondary" sx={{ fontSize: 14 }}>
                    Check each person who shares the expense, and customize the amount.
                  </Typography>
                </Box>

                <ToggleButtonGroup
                  value={draft.splitMode}
                  exclusive
                  fullWidth
                  aria-label="Split method"
                  onChange={(_event, value: SplitMode | null) => {
                    if (value) {
                      editDraft((current) => setCalculatorSplitMode(current, value));
                    }
                  }}
                  sx={{
                    "& .MuiToggleButton-root": {
                      py: 1,
                      borderColor: ledgerColors.line,
                      color: ledgerColors.ink,
                      fontWeight: 750,
                      textTransform: "none",
                      "&.Mui-selected": {
                        bgcolor: ledgerColors.blueSoft,
                        color: ledgerColors.blueDark,
                      },
                    },
                  }}
                >
                  <ToggleButton value="equal">Equal</ToggleButton>
                  <ToggleButton value="ratio">Ratio</ToggleButton>
                  <ToggleButton value="custom">Custom</ToggleButton>
                </ToggleButtonGroup>

                <CalculatorLiabilityRows
                  draft={draft}
                  issues={issues}
                  payerMemberIds={payerMemberIds}
                  selectedMemberIds={selectedMemberIds}
                  allocation={allocationPreview.liability}
                  editor={liabilityNameEditor}
                  onSelected={(memberId, selected) =>
                    editDraft((current) => setCalculatorMemberSelected(current, memberId, selected))
                  }
                  onRatio={(memberId, value) =>
                    editDraft((current) => updateCalculatorRatio(current, memberId, value))
                  }
                  onCustom={(memberId, value) =>
                    editDraft((current) => updateCalculatorCustomAmount(current, memberId, value))
                  }
                  onStartEdit={startLiabilityNameEdit}
                  onDelete={(memberId) => {
                    const deleted = deleteCalculatorLiabilityMember(draft, memberId);
                    if (!deleted.issue) {
                      editDraft(deleted.draft);
                    }
                  }}
                  onEditorValue={updateLiabilityNameEditor}
                  onCancelEditor={cancelLiabilityNameEditor}
                  onConfirmEditor={confirmLiabilityNameEditor}
                />

                <Button
                  type="button"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  disabled={liabilityNameEditor !== null}
                  onClick={startNewLiabilityMember}
                  sx={{ alignSelf: "flex-start" }}
                >
                  Add member
                </Button>

                <Box
                  sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 1,
                    pt: 1.5,
                    borderTop: `1px solid ${ledgerColors.line}`,
                  }}
                >
                  <Typography color="text.secondary" sx={{ fontSize: 14 }}>
                    {memberCount} {memberCount === 1 ? "member" : "members"}
                  </Typography>
                  <Typography sx={{ fontWeight: 800 }}>
                    Total paid: {formatCents(allocationPreview.totalPaid)}
                  </Typography>
                </Box>

                {formIssues.map((issue) => (
                  <InlineAlert key={issue.message}>{issue.message}</InlineAlert>
                ))}
                {storageWarning ? (
                  <Alert severity="warning" variant="outlined">
                    Browser saving is unavailable. You can keep calculating, but this draft may not
                    survive a refresh.
                  </Alert>
                ) : null}

                <Stack
                  direction={{ xs: "column-reverse", sm: "row" }}
                  spacing={1}
                  sx={{ justifyContent: "space-between" }}
                >
                  <Button
                    type="button"
                    variant="text"
                    color="inherit"
                    startIcon={<RestartAltIcon />}
                    onClick={() => setClearDialogOpen(true)}
                  >
                    Clear saved data
                  </Button>
                  <Button
                    type="submit"
                    variant="contained"
                    startIcon={<CalculateOutlinedIcon />}
                    disabled={liabilityNameEditor !== null}
                    sx={{ minWidth: { sm: 210 } }}
                  >
                    Calculate settlement
                  </Button>
                </Stack>
              </Stack>
            </Paper>

            {plan ? <SettlementResult plan={plan} draft={draft} /> : null}
          </Stack>
        </Box>

        <Box
          component="section"
          aria-labelledby="seisan-project-heading"
          sx={{
            borderTop: `1px solid ${ledgerColors.line}`,
            borderBottom: `1px solid ${ledgerColors.line}`,
            bgcolor: ledgerColors.paper,
          }}
        >
          <Box
            sx={{
              width: "min(1060px, 100%)",
              mx: "auto",
              px: { xs: 2, sm: 3 },
              py: { xs: 6, md: 8 },
            }}
          >
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "0.9fr 1.1fr" },
                gap: { xs: 4, md: 8 },
                alignItems: "start",
              }}
            >
              <Stack spacing={2.25} sx={{ alignItems: "flex-start" }}>
                <Typography
                  id="seisan-project-heading"
                  component="h2"
                  sx={{
                    fontFamily: ledgerFonts.serif,
                    fontSize: { xs: 34, md: 42 },
                    fontWeight: 700,
                    lineHeight: 1.05,
                  }}
                >
                  Too many expenses to track?
                </Typography>
                <Typography
                  color="text.secondary"
                  sx={{ maxWidth: { xs: "100%", md: 430 }, lineHeight: 1.65 }}
                >
                  We got you covered. Try a shared project and record expenses as they happen
                  instead of rebuilding the total by hand.
                </Typography>
                <Button
                  component={Link}
                  to={session.data ? "/projects/new" : "/login?returnTo=%2Fprojects%2Fnew"}
                  variant="contained"
                  endIcon={<ArrowForwardIcon />}
                  sx={{
                    alignSelf: { xs: "stretch", sm: "flex-start" },
                    whiteSpace: "nowrap",
                  }}
                >
                  {session.data ? "Create a shared project" : "Sign in to start a shared project"}
                </Button>
              </Stack>

              <Stack divider={<Divider flexItem />} spacing={0}>
                {[
                  {
                    title: "Track every expense together.",
                    copy: "Stop computing the total by hand. Record every expense and collaborate.",
                    Icon: GroupsOutlinedIcon,
                  },
                  {
                    title: "Everyone gets a personalized transfer plan.",
                    copy: "It is more powerful than the calculator above, for sure.",
                    Icon: AltRouteOutlinedIcon,
                  },
                  {
                    title: "Free without daily posting cap.",
                    copy: "A PRO subscription just for tracking expenses? Come on. You don't need it. We don't offer it.",
                    Icon: MoneyOffOutlinedIcon,
                  },
                ].map(({ title, copy, Icon }) => (
                  <Box
                    key={title}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "32px minmax(0, 1fr)",
                      gap: 1.5,
                      py: 2.25,
                    }}
                  >
                    <Icon
                      aria-hidden="true"
                      sx={{ mt: 0.125, color: ledgerColors.blueDark, fontSize: 22 }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 800 }}>{title}</Typography>
                      <Typography color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.6 }}>
                        {copy}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Box>

            <Stack
              direction="row"
              spacing={1}
              sx={{
                mt: { xs: 3.5, md: 4.5 },
                pt: 2,
                alignItems: "flex-start",
                borderTop: `1px solid ${ledgerColors.line}`,
                color: "text.secondary",
              }}
            >
              <Typography sx={{ fontSize: 13.5, lineHeight: 1.6 }}>
                Full Seisan projects store expense data on Seisan&apos;s servers so collaborators
                can stay in sync. Seisan uses access controls and other safeguards to protect
                project data. See the{" "}
                <Box
                  component={Link}
                  to="/privacy"
                  sx={{
                    color: "inherit",
                    fontWeight: 750,
                    textDecoration: "underline",
                    textUnderlineOffset: "3px",
                  }}
                >
                  Privacy Policy
                </Box>
                .
              </Typography>
            </Stack>
          </Box>
        </Box>

        <Box
          component="section"
          aria-labelledby="faq-heading"
          sx={{
            width: "min(860px, 100%)",
            mx: "auto",
            px: { xs: 2, sm: 3 },
            pt: { xs: 6, md: 8 },
            pb: { xs: 7, md: 10 },
          }}
        >
          <Typography
            id="faq-heading"
            component="h2"
            sx={{
              mb: 3,
              fontFamily: ledgerFonts.serif,
              fontSize: { xs: 34, md: 42 },
              fontWeight: 700,
            }}
          >
            Frequently asked questions
          </Typography>
          {FAQS.map(({ question, answer }) => (
            <Accordion
              key={question}
              disableGutters
              elevation={0}
              square
              sx={{
                borderTop: `1px solid ${ledgerColors.line}`,
                bgcolor: "transparent",
                "&:last-of-type": { borderBottom: `1px solid ${ledgerColors.line}` },
                "&::before": { display: "none" },
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography sx={{ fontWeight: 800 }}>{question}</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography color="text.secondary" sx={{ lineHeight: 1.65 }}>
                  {answer}
                </Typography>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      </Box>

      <Stack
        component="footer"
        direction={{ xs: "column", sm: "row" }}
        sx={{
          width: "min(1180px, 100%)",
          mx: "auto",
          px: { xs: 2, sm: 3 },
          py: 3,
          borderTop: `1px solid ${ledgerColors.line}`,
          alignItems: { xs: "flex-start", sm: "center" },
          justifyContent: "space-between",
          gap: 1.5,
        }}
      >
        <BrandLink size="compact" />
        <Stack direction="row" spacing={2}>
          <Typography
            component={Link}
            to="/privacy"
            color="text.secondary"
            sx={{ fontSize: 13, fontWeight: 700 }}
          >
            Privacy
          </Typography>
          <Typography
            component={Link}
            to="/api-docs"
            color="text.secondary"
            sx={{ fontSize: 13, fontWeight: 700 }}
          >
            API
          </Typography>
        </Stack>
      </Stack>

      <Dialog open={clearDialogOpen} onClose={() => setClearDialogOpen(false)}>
        <DialogTitle>Clear saved calculator data?</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            This removes the draft stored in this browser and restores a blank calculator.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearDialogOpen(false)}>Cancel</Button>
          <Button color="error" onClick={confirmClear}>
            Clear saved data
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const liabilityActionSx = {
  width: 32,
  height: 32,
  p: 0.5,
  border: 0,
  color: "text.secondary",
  "&:hover": { bgcolor: "action.hover", color: "text.primary" },
  "&.Mui-disabled": { color: "action.disabled" },
} as const;

function CalculatorLiabilityRows({
  draft,
  issues,
  payerMemberIds,
  selectedMemberIds,
  allocation,
  editor,
  onSelected,
  onRatio,
  onCustom,
  onStartEdit,
  onDelete,
  onEditorValue,
  onCancelEditor,
  onConfirmEditor,
}: {
  draft: CalculatorDraft;
  issues: CalculatorIssue[];
  payerMemberIds: Set<number>;
  selectedMemberIds: Set<number>;
  allocation: Record<string, number>;
  editor: LiabilityNameEditor | null;
  onSelected: (memberId: number, selected: boolean) => void;
  onRatio: (memberId: number, value: string) => void;
  onCustom: (memberId: number, value: string) => void;
  onStartEdit: (memberId: number, name: string) => void;
  onDelete: (memberId: number) => void;
  onEditorValue: (value: string) => void;
  onCancelEditor: () => void;
  onConfirmEditor: () => void;
}) {
  const rowColumns =
    draft.splitMode === "equal"
      ? "32px minmax(36px, 1fr) minmax(62px, auto) 32px 32px"
      : draft.splitMode === "ratio"
        ? "32px minmax(36px, 1fr) minmax(62px, auto) minmax(58px, 76px) 32px 32px"
        : "32px minmax(36px, 1fr) minmax(78px, 100px) 32px 32px";
  const rowSx = {
    display: "grid",
    gridTemplateColumns: rowColumns,
    columnGap: { xs: 0.25, sm: 0.75 },
    alignItems: "center",
    minHeight: 46,
    py: 0.375,
  } as const;
  const compactInputSx = {
    minWidth: 0,
    "& .MuiInputBase-root": { height: 36 },
    "& .MuiInputBase-input": { px: { xs: 0.75, sm: 1 }, textAlign: "right" },
  } as const;

  return (
    <Stack spacing={0}>
      {draft.members.length === 0 && editor?.kind !== "new" ? (
        <Typography color="text.secondary" sx={{ py: 0.75, fontSize: 13.5 }}>
          Name a payer or add a member to build the group.
        </Typography>
      ) : null}

      {draft.members.map((member) => {
        const isPayer = payerMemberIds.has(member.id);
        const selected = selectedMemberIds.has(member.id);
        const isEditing = editor?.kind === "member" && editor.memberId === member.id;
        const anotherEditorOpen = editor !== null && !isEditing;
        const splitIssue =
          draft.splitMode === "ratio"
            ? issueForMember(issues, member.id, "ratio")
            : draft.splitMode === "custom"
              ? issueForMember(issues, member.id, "custom")
              : null;
        const editDisabled = isPayer || anotherEditorOpen;

        return (
          <Box key={member.id} sx={rowSx}>
            <Checkbox
              size="small"
              checked={selected}
              disabled={isEditing}
              slotProps={{
                input: {
                  "aria-label": `${selected ? "Exclude" : "Include"} ${member.name} ${
                    selected ? "from" : "in"
                  } the split`,
                },
              }}
              onChange={(event) => onSelected(member.id, event.target.checked)}
              sx={{ p: 0.5 }}
            />

            {isEditing ? (
              <TextField
                autoFocus
                size="small"
                placeholder="Member name"
                value={editor.value}
                error={Boolean(editor.issue)}
                onChange={(event) => onEditorValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onConfirmEditor();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    onCancelEditor();
                  }
                }}
                slotProps={{
                  htmlInput: {
                    "aria-label": `Edit ${member.name} member name`,
                    maxLength: MAX_CALCULATOR_MEMBER_NAME_LENGTH + 1,
                  },
                }}
                sx={{
                  minWidth: 0,
                  "& .MuiInputBase-root": { height: 36 },
                  "& .MuiInputBase-input": { px: 1 },
                }}
              />
            ) : (
              <Typography
                title={member.name}
                sx={{
                  minWidth: 0,
                  overflow: "hidden",
                  color: selected ? "text.primary" : "text.secondary",
                  fontWeight: selected ? 550 : 450,
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {member.name}
              </Typography>
            )}

            {draft.splitMode !== "custom" ? (
              <Typography
                aria-label={`${member.name} allocated share ${formatCents(
                  allocation[member.id] ?? 0,
                )}`}
                sx={{
                  minWidth: 0,
                  overflow: "hidden",
                  fontSize: { xs: 13.5, sm: 14.5 },
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 750,
                  textAlign: "right",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {formatCents(allocation[member.id] ?? 0)}
              </Typography>
            ) : null}

            {draft.splitMode === "ratio" ? (
              <Tooltip title={splitIssue ?? ""}>
                <TextField
                  size="small"
                  inputMode="decimal"
                  value={draft.ratios[member.id] ?? "1"}
                  disabled={isEditing}
                  error={Boolean(splitIssue)}
                  onChange={(event) => onRatio(member.id, event.target.value)}
                  slotProps={{
                    htmlInput: {
                      "aria-label": `${member.name} ratio`,
                      "aria-describedby": splitIssue
                        ? `calculator-member-${member.id}-issue`
                        : undefined,
                    },
                  }}
                  sx={compactInputSx}
                />
              </Tooltip>
            ) : null}

            {draft.splitMode === "custom" ? (
              <Tooltip title={splitIssue ?? ""}>
                <TextField
                  size="small"
                  inputMode="decimal"
                  value={draft.customAmounts[member.id] ?? ""}
                  disabled={isEditing}
                  error={Boolean(splitIssue)}
                  onChange={(event) => onCustom(member.id, event.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    },
                    htmlInput: {
                      "aria-label": `${member.name} custom share`,
                      "aria-describedby": splitIssue
                        ? `calculator-member-${member.id}-issue`
                        : undefined,
                    },
                  }}
                  sx={{
                    ...compactInputSx,
                    "& .MuiInputAdornment-root": { mr: 0.25 },
                    "& .MuiInputBase-root": { height: 36, pl: 0.75 },
                    "& .MuiInputBase-input": {
                      px: { xs: 0.25, sm: 0.5 },
                      textAlign: "right",
                    },
                  }}
                />
              </Tooltip>
            ) : null}

            {isEditing ? (
              <Tooltip title="Cancel name edit">
                <IconButton
                  type="button"
                  size="small"
                  aria-label={`Cancel editing ${member.name}`}
                  onClick={onCancelEditor}
                  sx={liabilityActionSx}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip
                title={
                  editDisabled
                    ? isPayer
                      ? "Edit this payer's name in Who paid."
                      : "Finish editing the current member first."
                    : "Edit member name"
                }
              >
                <span style={{ display: "flex" }}>
                  <IconButton
                    type="button"
                    size="small"
                    disabled={editDisabled}
                    aria-label={
                      isPayer
                        ? `Cannot edit ${member.name} here while they are a payer`
                        : `Edit ${member.name}`
                    }
                    onClick={() => onStartEdit(member.id, member.name)}
                    sx={liabilityActionSx}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}

            {isEditing ? (
              <Tooltip title="Save member name">
                <IconButton
                  type="button"
                  size="small"
                  aria-label={`Save ${member.name} member name`}
                  onClick={onConfirmEditor}
                  sx={liabilityActionSx}
                >
                  <CheckIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip
                title={
                  isPayer
                    ? "Remove this person from Who paid before deleting them."
                    : anotherEditorOpen
                      ? "Finish editing the current member first."
                      : "Delete member"
                }
              >
                <span style={{ display: "flex" }}>
                  <IconButton
                    type="button"
                    size="small"
                    disabled={isPayer || anotherEditorOpen}
                    aria-label={
                      isPayer
                        ? `Cannot delete ${member.name} while they are a payer`
                        : `Delete ${member.name}`
                    }
                    onClick={() => onDelete(member.id)}
                    sx={liabilityActionSx}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}

            {isEditing && editor.issue ? (
              <Typography
                role="alert"
                color="error"
                sx={{ gridColumn: "2 / -1", mt: 0.125, fontSize: 12 }}
              >
                {editor.issue}
              </Typography>
            ) : splitIssue ? (
              <Typography
                id={`calculator-member-${member.id}-issue`}
                role="alert"
                color="error"
                sx={{ gridColumn: "2 / -1", mt: 0.125, fontSize: 12 }}
              >
                {splitIssue}
              </Typography>
            ) : null}
          </Box>
        );
      })}

      {editor?.kind === "new" ? (
        <Box sx={rowSx}>
          <Checkbox
            size="small"
            checked
            disabled
            slotProps={{ input: { "aria-label": "New member included in the split" } }}
            sx={{ p: 0.5 }}
          />
          <TextField
            autoFocus
            size="small"
            placeholder="Member name"
            value={editor.value}
            error={Boolean(editor.issue)}
            onChange={(event) => onEditorValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onConfirmEditor();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCancelEditor();
              }
            }}
            slotProps={{
              htmlInput: {
                "aria-label": "New member name",
                maxLength: MAX_CALCULATOR_MEMBER_NAME_LENGTH + 1,
              },
            }}
            sx={{
              minWidth: 0,
              "& .MuiInputBase-root": { height: 36 },
              "& .MuiInputBase-input": { px: 1 },
            }}
          />
          {draft.splitMode !== "custom" ? (
            <Typography
              aria-label="New member allocated share $0.00"
              sx={{
                fontSize: { xs: 13.5, sm: 14.5 },
                fontVariantNumeric: "tabular-nums",
                fontWeight: 750,
                textAlign: "right",
                whiteSpace: "nowrap",
              }}
            >
              {formatCents(0)}
            </Typography>
          ) : null}
          {draft.splitMode === "ratio" ? (
            <TextField
              size="small"
              value="1"
              disabled
              slotProps={{ htmlInput: { "aria-label": "New member ratio" } }}
              sx={compactInputSx}
            />
          ) : null}
          {draft.splitMode === "custom" ? (
            <TextField
              size="small"
              value=""
              disabled
              slotProps={{ htmlInput: { "aria-label": "New member custom share" } }}
              sx={compactInputSx}
            />
          ) : null}
          <Tooltip title="Cancel new member">
            <IconButton
              type="button"
              size="small"
              aria-label="Cancel new member"
              onClick={onCancelEditor}
              sx={liabilityActionSx}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Add member">
            <IconButton
              type="button"
              size="small"
              aria-label="Confirm new member"
              onClick={onConfirmEditor}
              sx={liabilityActionSx}
            >
              <CheckIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {editor.issue ? (
            <Typography
              role="alert"
              color="error"
              sx={{ gridColumn: "2 / -1", mt: 0.125, fontSize: 12 }}
            >
              {editor.issue}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}

function SettlementResult({ plan, draft }: { plan: CalculatorPlan; draft: CalculatorDraft }) {
  const names = new Map(draft.members.map((member) => [member.id, member.name]));
  const transfers = plan.transfers.flatMap((batch) =>
    batch.dests.map((destination) => ({
      src: batch.src,
      dest: destination.id,
      amount: destination.amount,
    })),
  );

  return (
    <Paper
      square
      aria-live="polite"
      sx={{
        ...paperFrameSx,
        overflow: "hidden",
        borderColor: ledgerColors.blue,
      }}
    >
      <Box sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Typography variant="h2" sx={{ fontFamily: ledgerFonts.serif }}>
          Settlement plan
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
          Total shared: {formatCents(plan.totalPaid)}
        </Typography>
        {transfers.length === 0 ? (
          <Alert severity="success" variant="outlined">
            Everyone is settled. No transfers are needed.
          </Alert>
        ) : (
          <Stack spacing={0} divider={<Divider flexItem />}>
            {transfers.map((transfer) => (
              <Box
                key={`${transfer.src}:${transfer.dest}`}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 2,
                  alignItems: "center",
                  py: 1.75,
                }}
              >
                <Typography sx={{ fontWeight: 750 }}>
                  {names.get(transfer.src) ?? `#${transfer.src}`} should pay{" "}
                  {names.get(transfer.dest) ?? `#${transfer.dest}`}
                </Typography>
                <Typography sx={{ color: ledgerColors.blueDark, fontWeight: 900 }}>
                  {formatCents(transfer.amount)}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}

function issueForPayer(
  issues: CalculatorIssue[],
  key: number,
  field: "payerName" | "payerAmount",
): string | null {
  return issues.find((issue) => issue.field === field && issue.key === key)?.message ?? null;
}

function issueForMember(
  issues: CalculatorIssue[],
  memberId: number,
  field: "memberName" | "ratio" | "custom",
): string | null {
  return (
    issues.find((issue) => issue.field === field && issue.memberId === memberId)?.message ?? null
  );
}

function useCalculatorMetadata() {
  useEffect(() => {
    setMetaContent('meta[name="description"]', PAGE_DESCRIPTION);
    setMetaContent('meta[property="og:title"]', PAGE_TITLE);
    setMetaContent('meta[property="og:description"]', PAGE_DESCRIPTION);
    setMetaContent('meta[name="twitter:title"]', PAGE_TITLE);
    setMetaContent('meta[name="twitter:description"]', PAGE_DESCRIPTION);

    const existing = document.getElementById(SOFTWARE_APPLICATION_ID);
    existing?.remove();
    const script = document.createElement("script");
    script.id = SOFTWARE_APPLICATION_ID;
    script.type = "application/ld+json";
    script.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Seisan Group Expense Calculator",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any",
      url: "https://seisan.waga.me/",
      description: PAGE_DESCRIPTION,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    });
    document.head.append(script);
    return () => script.remove();
  }, []);
}

function setMetaContent(selector: string, content: string) {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute("content", content);
}

const FAQS = [
  {
    question: "Do I need an account?",
    answer:
      "No. The calculator works for every visitor without signing in. An account is only needed if you want a shared Seisan project.",
  },
  {
    question: "Is my calculator data uploaded to the server?",
    answer: (
      <>
        No. Names, payment amounts, and split settings entered in this calculator are never uploaded
        to Seisan&apos;s servers, and the settlement calculation is performed locally in your
        browser. Your draft is saved only in this browser&apos;s local storage. It is not
        synchronized to another browser or device, and you can clear it from the calculator. This
        applies only to this public calculator. See our{" "}
        <Box
          component={Link}
          to="/privacy"
          sx={{
            color: "inherit",
            fontWeight: 750,
            textDecoration: "underline",
            textUnderlineOffset: "3px",
          }}
        >
          Privacy Policy
        </Box>{" "}
        for how Seisan projects handle data.
      </>
    ),
  },
  {
    question: "Can I split an expense unequally?",
    answer:
      "Yes. Ratio mode accepts positive decimal weights, and Custom mode accepts an exact non-negative dollar share for every member.",
  },
  {
    question: "Can I enter multiple expenses?",
    answer:
      "This calculator handles one aggregate total. Combine what each person paid and what each person should owe before calculating. To enter multiple expenses individually, create a shared Seisan project and record each expense as it happens.",
  },
  {
    question: "How is the settlement plan calculated?",
    answer:
      "The calculator compares each member's paid amount with their share, then deterministically matches people who owe money with people who are owed money.",
  },
] as const;
