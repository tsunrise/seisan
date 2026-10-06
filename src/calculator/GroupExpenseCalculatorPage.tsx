import AddIcon from "@mui/icons-material/Add";
import CalculateOutlinedIcon from "@mui/icons-material/CalculateOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { FormEvent } from "react";
import { useState } from "react";
import { Link } from "react-router";

import { BrandLink } from "../components/BrandLink";
import { InlineAlert } from "../components/InlineAlert";
import { paperFrameSx } from "../components/styles";
import { formatCents } from "../domain";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { ledgerColors, ledgerFonts } from "../theme";
import type { SplitMode } from "../types";
import { CALCULATOR_PAGE_TITLE, useCalculatorMetadata } from "./calculatorMetadata";
import {
  CalculatorFaqSection,
  CalculatorFooter,
  ProjectConversionSection,
} from "./CalculatorLandingSections";
import { CalculatorLiabilityRows } from "./CalculatorLiabilityRows";
import { CalculatorPayerRows } from "./CalculatorPayerRows";
import { CalculatorSettlementResult } from "./CalculatorSettlementResult";
import { useGroupExpenseCalculator } from "./useGroupExpenseCalculator";

/**
 * Public root page: a browser-only group expense calculator for one aggregate total, followed by
 * the shared-project conversion section and FAQ. Nothing here calls the API except the session
 * check that picks the header link.
 */
export function GroupExpenseCalculatorPage() {
  const session = useCurrentUser({ required: false });
  const calculator = useGroupExpenseCalculator();
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const { draft, issues, nameEditor } = calculator;
  const formIssues = issues.filter((issue) => issue.field === "form");
  const memberCount = draft.members.length;

  useDocumentTitle(CALCULATOR_PAGE_TITLE);
  useCalculatorMetadata();

  function calculate(event: FormEvent) {
    event.preventDefault();
    calculator.calculate();
  }

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
          <CalculatorIntro />

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
                <SectionHeading
                  title="Who paid?"
                  description="Add every person who covered part of the total."
                />

                <CalculatorPayerRows
                  draft={draft}
                  issues={issues}
                  onChange={calculator.updatePayer}
                  onCommitName={calculator.commitPayerName}
                  onRemove={calculator.removePayer}
                />

                <Button
                  type="button"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={calculator.addPayer}
                  sx={{ alignSelf: "flex-start" }}
                >
                  Add payer
                </Button>

                <Divider />

                <SectionHeading
                  title="How should the total be shared?"
                  description="Check each person who shares the expense, and customize the amount."
                />

                <ToggleButtonGroup
                  value={draft.splitMode}
                  exclusive
                  fullWidth
                  aria-label="Split method"
                  onChange={(_event, value: SplitMode | null) => {
                    if (value) {
                      calculator.setSplitMode(value);
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
                  payerMemberIds={calculator.payerMemberIds}
                  selectedMemberIds={calculator.selectedMemberIds}
                  allocation={calculator.allocationPreview.liability}
                  editor={nameEditor}
                  onSelected={calculator.setMemberSelected}
                  onRatio={calculator.updateRatio}
                  onCustom={calculator.updateCustomAmount}
                  onStartEdit={calculator.startRenameMember}
                  onDelete={calculator.deleteMember}
                  onEditorValue={calculator.updateNameEditor}
                  onCancelEditor={calculator.cancelNameEditor}
                  onConfirmEditor={calculator.confirmNameEditor}
                />

                <Button
                  type="button"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  disabled={nameEditor !== null}
                  onClick={calculator.startNewMember}
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
                    Total paid: {formatCents(calculator.allocationPreview.totalPaid)}
                  </Typography>
                </Box>

                {formIssues.map((issue) => (
                  <InlineAlert key={issue.message}>{issue.message}</InlineAlert>
                ))}
                {calculator.storageWarning ? (
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
                    disabled={nameEditor !== null}
                    sx={{ minWidth: { sm: 210 } }}
                  >
                    Calculate settlement
                  </Button>
                </Stack>
              </Stack>
            </Paper>

            {calculator.plan ? (
              <CalculatorSettlementResult plan={calculator.plan} draft={draft} />
            ) : null}
          </Stack>
        </Box>

        <ProjectConversionSection signedIn={Boolean(session.data)} />
        <CalculatorFaqSection />
      </Box>

      <CalculatorFooter />

      <Dialog open={clearDialogOpen} onClose={() => setClearDialogOpen(false)}>
        <DialogTitle>Clear saved calculator data?</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            This removes the draft stored in this browser and restores a blank calculator.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearDialogOpen(false)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              calculator.clearSavedData();
              setClearDialogOpen(false);
            }}
          >
            Clear saved data
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function CalculatorIntro() {
  return (
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
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary" }}>
        <LockOutlinedIcon sx={{ fontSize: 17 }} />
        <Typography sx={{ fontSize: 13.5 }}>
          The calculator runs entirely in your browser.
        </Typography>
      </Stack>
    </Stack>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <Box>
      <Typography variant="h2" sx={{ fontFamily: ledgerFonts.serif, mb: 0.5 }}>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ fontSize: 14 }}>
        {description}
      </Typography>
    </Box>
  );
}
