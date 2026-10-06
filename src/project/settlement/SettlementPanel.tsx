import CheckOutlinedIcon from "@mui/icons-material/CheckOutlined";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Button, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import * as api from "../../api";
import { getApiErrorMessage } from "../../api/errorMessages";
import { InlineAlert } from "../../components/InlineAlert";
import { MemberPaymentMethod } from "../../components/MemberPaymentMethod";
import { PanelFrame } from "../../components/PanelFrame";
import { deriveDelta, memberBalance, memberName } from "../../domain";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import { ledgerColors } from "../../theme";
import { transferPrefillSearch } from "../composer/transferForm";
import { projectPaths } from "../paths";
import { SettlementComplete } from "./SettlementComplete";
import { SettlementPaymentList } from "./SettlementPaymentList";
import {
  incomingSettlementPaymentsForMember,
  outgoingSettlementPayments,
  settlementBatchForMember,
} from "./settlementPlan";

type SettlementState =
  | { status: "loading"; transfers: api.TransferBatch[]; error: null }
  | { status: "ready"; transfers: api.TransferBatch[]; error: null }
  | { status: "error"; transfers: api.TransferBatch[]; error: string };

/**
 * Member-specific settlement view. A member who owes money sees their outgoing batch with a
 * confirmation action and per-recipient customization links; a member who is owed sees incoming
 * payments instead. The rest of the project plan stays collapsed behind a toggle.
 */
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

  // Refetch whenever the project changes; the previous plan stays visible until the new one loads.
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

  const ready = state.status === "ready";
  const memberTransfer = settlementBatchForMember(state.transfers, currentMember.id);
  const incomingPayments = incomingSettlementPaymentsForMember(state.transfers, currentMember.id);
  const currentMemberIsSettled =
    memberBalance(project.balance, currentMember.id) === 0 &&
    memberTransfer === null &&
    incomingPayments.length === 0;
  const otherTransfers = state.transfers.filter((transfer) => transfer.src !== currentMember.id);

  async function confirmTransfers() {
    if (!memberTransfer || posting) {
      return;
    }
    setPosting(true);
    try {
      const description: api.WritableRecordDescription = { type: "transfer", ...memberTransfer };
      await api.appendRecord(project.id, {
        description,
        delta: deriveDelta(description),
        settle: true,
      });
      showSuccess("Settlement transfer recorded.");
      onPosted();
      navigate(projectPaths.timeline(project.id));
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setPosting(false);
    }
  }

  return (
    <PanelFrame title="Settle up" backTo={projectPaths.timeline(project.id)}>
      <Stack spacing={2}>
        {!ready ||
        (state.transfers.length > 0 && incomingPayments.length === 0 && !currentMemberIsSettled) ? (
          <Typography color="text.secondary">
            Follow this plan to clear your balance. It is generated to minimize the total number of
            transfers across the project.
          </Typography>
        ) : null}
        {ready && incomingPayments.length > 0 ? (
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
        {ready && memberTransfer ? (
          <SettlementPaymentList
            project={project}
            payments={outgoingSettlementPayments(memberTransfer)}
            title="Your transfers"
          />
        ) : null}
        {ready && incomingPayments.length > 0 ? (
          <SettlementPaymentList
            project={project}
            payments={incomingPayments}
            title="Transfers to you"
            direction="incoming"
          />
        ) : null}
        {ready && state.transfers.length === 0 ? <SettlementComplete scope="project" /> : null}
        {ready && state.transfers.length > 0 && currentMemberIsSettled ? (
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
            {memberTransfer.dests.map((destination) => {
              const recipientName = memberName(project.members, destination.id);
              return (
                <Button
                  key={destination.id}
                  component={Link}
                  to={projectPaths.newRecord(
                    project.id,
                    transferPrefillSearch(memberTransfer, destination.id),
                  )}
                  variant="outlined"
                  aria-label={`Customize transfer amount for ${recipientName}`}
                  fullWidth
                >
                  {memberTransfer.dests.length === 1
                    ? "Customize transfer amount"
                    : `Customize transfer amount for ${recipientName}`}
                </Button>
              );
            })}
          </Stack>
        ) : null}
        {ready && otherTransfers.length > 0 ? (
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
                      payments={outgoingSettlementPayments(transfer)}
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
