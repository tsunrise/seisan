import CheckOutlinedIcon from "@mui/icons-material/CheckOutlined";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Box, Button, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { InlineAlert } from "../components/InlineAlert";
import { MemberPaymentMethod } from "../components/MemberPaymentMethod";
import { PanelFrame } from "../components/PanelFrame";
import { deriveDelta, memberName } from "../domain";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { ledgerColors } from "../theme";
import { incomingSettlementPaymentsForMember, settlementBatchForMember } from "./settlementPlan";
import { SettlementPaymentList } from "./SettlementPaymentList";
import { transferPrefillSearch } from "./transferForm";

type SettlementState =
  | { status: "loading"; transfers: api.TransferBatch[]; error: null }
  | { status: "ready"; transfers: api.TransferBatch[]; error: null }
  | { status: "error"; transfers: api.TransferBatch[]; error: string };

function SettlementComplete({ scope }: { scope: "member" | "project" }) {
  const projectIsSettled = scope === "project";

  return (
    <Stack
      role="status"
      sx={{ alignItems: "center", justifyContent: "center", minHeight: 230, px: 2, py: 4 }}
    >
      <Box
        sx={{
          alignItems: "center",
          bgcolor: ledgerColors.paperSoft,
          border: `1px solid ${ledgerColors.line}`,
          borderRadius: "50%",
          color: "success.main",
          display: "flex",
          height: 72,
          justifyContent: "center",
          mb: 2.25,
          width: 72,
        }}
      >
        <CheckOutlinedIcon sx={{ fontSize: 40 }} />
      </Box>
      <Typography variant="h2" sx={{ mb: 0.75, textAlign: "center" }}>
        {projectIsSettled ? "Everyone is settled" : "You're settled"}
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 280, textAlign: "center" }}>
        {projectIsSettled
          ? "All balances are clear. No transfers are needed."
          : "Your balance is clear. No transfers are needed from you."}
      </Typography>
    </Stack>
  );
}

export function SettlementPanel({
  project,
  currentMember,
  onPosted,
}: {
  project: api.Project;
  currentMember: api.ProjectMemberFull;
  onPosted: () => void;
}) {
  const navigate = useNavigate();
  const { showError, showSuccess } = useAppSnackbar();
  const [state, setState] = useState<SettlementState>({
    status: "loading",
    transfers: [],
    error: null,
  });
  const [showFullPlan, setShowFullPlan] = useState(false);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .getSettlementPlan(project.id)
      .then((result) => {
        if (active) {
          setState({ status: "ready", transfers: result.transfers, error: null });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", transfers: [], error: getApiErrorMessage(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [project.id, project.updatedAt]);

  const memberTransfer = settlementBatchForMember(state.transfers, currentMember.id);
  const incomingPayments = incomingSettlementPaymentsForMember(state.transfers, currentMember.id);
  const currentMemberIsSettled =
    (project.balance[String(currentMember.id)] ?? 0) === 0 &&
    memberTransfer === null &&
    incomingPayments.length === 0;
  const otherTransfers = state.transfers.filter((transfer) => transfer.src !== currentMember.id);

  async function confirmTransfers() {
    if (!memberTransfer || posting) {
      return;
    }
    setPosting(true);
    try {
      const description: api.RecordDescription = { type: "transfer", ...memberTransfer };
      await api.appendRecord(project.id, {
        description,
        delta: deriveDelta(description),
        settle: true,
      });
      showSuccess("Settlement transfer recorded.");
      onPosted();
      navigate(`/project/${project.id}`);
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setPosting(false);
    }
  }

  return (
    <PanelFrame title="Settle up" backTo={`/project/${project.id}`}>
      <Stack spacing={2}>
        {state.status !== "ready" ||
        (state.transfers.length > 0 && incomingPayments.length === 0 && !currentMemberIsSettled) ? (
          <Typography color="text.secondary">
            Follow this plan to clear your balance. It is generated to minimize the total number of
            transfers across the project.
          </Typography>
        ) : null}
        {state.status === "ready" && incomingPayments.length > 0 ? (
          <Stack spacing={0.75}>
            <Typography color="text.secondary">
              The following members should transfer money to you. This plan is generated to minimize
              the total number of transfers across the project.
            </Typography>
            <MemberPaymentMethod member={currentMember} prefix="Your transfer method" />
          </Stack>
        ) : null}
        {state.status === "loading" ? (
          <Stack sx={{ alignItems: "center", minHeight: 180, justifyContent: "center" }}>
            <CircularProgress size={28} />
          </Stack>
        ) : null}
        {state.status === "error" ? <InlineAlert>{state.error}</InlineAlert> : null}
        {state.status === "ready" && memberTransfer ? (
          <SettlementPaymentList
            project={project}
            payments={memberTransfer.dests.map((destination) => ({
              memberId: destination.id,
              amount: destination.amount,
            }))}
            title="Your transfers"
          />
        ) : null}
        {state.status === "ready" && incomingPayments.length > 0 ? (
          <SettlementPaymentList
            project={project}
            payments={incomingPayments}
            title="Transfers to you"
            direction="incoming"
          />
        ) : null}
        {state.status === "ready" && state.transfers.length === 0 ? (
          <SettlementComplete scope="project" />
        ) : null}
        {state.status === "ready" && state.transfers.length > 0 && currentMemberIsSettled ? (
          <SettlementComplete scope="member" />
        ) : null}
        {memberTransfer ? (
          <Stack spacing={1}>
            <Button
              type="button"
              variant="contained"
              startIcon={<CheckOutlinedIcon />}
              disabled={posting}
              onClick={() => void confirmTransfers()}
            >
              I have completed my transfers
            </Button>
            {memberTransfer.dests.map((destination) => (
              <Button
                key={destination.id}
                component={Link}
                to={`/project/${project.id}/records/new?${transferPrefillSearch(
                  memberTransfer,
                  destination.id,
                )}`}
                variant="outlined"
                aria-label={`Customize transfer amount for ${memberName(
                  project.members,
                  destination.id,
                )}`}
                fullWidth
              >
                {memberTransfer.dests.length === 1
                  ? "Customize transfer amount"
                  : `Customize transfer amount for ${memberName(project.members, destination.id)}`}
              </Button>
            ))}
          </Stack>
        ) : null}
        {state.status === "ready" && otherTransfers.length > 0 ? (
          <>
            <Button
              type="button"
              variant="text"
              endIcon={showFullPlan ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              aria-expanded={showFullPlan}
              onClick={() => setShowFullPlan((current) => !current)}
              sx={{ alignSelf: "flex-start", px: 0 }}
            >
              {showFullPlan ? "Hide full settlement plan" : "Show full settlement plan"}
            </Button>
            {showFullPlan ? (
              <Stack spacing={2.25}>
                <Divider sx={{ borderColor: ledgerColors.line }} />
                <Typography variant="h2">
                  {memberTransfer ? "Rest of the project plan" : "Full project plan"}
                </Typography>
                {otherTransfers.map((transfer, index) => (
                  <Stack key={transfer.src} spacing={2.25}>
                    {index > 0 ? <Divider sx={{ borderColor: ledgerColors.line }} /> : null}
                    <SettlementPaymentList
                      project={project}
                      payments={transfer.dests.map((destination) => ({
                        memberId: destination.id,
                        amount: destination.amount,
                      }))}
                      title={memberName(project.members, transfer.src)}
                    />
                  </Stack>
                ))}
              </Stack>
            ) : null}
          </>
        ) : null}
      </Stack>
    </PanelFrame>
  );
}
