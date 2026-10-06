import BalanceOutlinedIcon from "@mui/icons-material/BalanceOutlined";
import HandshakeIcon from "@mui/icons-material/Handshake";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import { ButtonBase, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import * as api from "../../api";
import { InlineAlert } from "../../components/InlineAlert";
import { PanelFrame } from "../../components/PanelFrame";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import { ledgerColors } from "../../theme";
import { RecordComposer } from "../composer/RecordComposer";
import { transferPrefillFromSearch } from "../composer/transferForm";
import {
  recordComposerNouns,
  type RecordComposerKind,
  type RecordComposerSubmission,
} from "../composer/types";
import { projectPaths } from "../paths";

/**
 * Record-type chooser that opens the matching composer. A settlement "customize" link arrives with
 * a transfer prefill in the query string and skips straight to the transfer composer.
 */
export function NewRecordPanel({
  project,
  currentMember,
  categories,
  onPosted,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
  categories: api.Category[];
  onPosted: () => void;
}) {
  const navigate = useNavigate();
  const { showSuccess } = useAppSnackbar();
  const [search] = useSearchParams();
  const transferPrefill = transferPrefillFromSearch(search, project.members);
  const [kind, setKind] = useState<RecordComposerKind | null>(transferPrefill ? "transfer" : null);
  const newRecordPath = projectPaths.newRecord(project.id);

  function returnToChoice() {
    setKind(null);
    if (search.size > 0) {
      navigate(newRecordPath, { replace: true });
    }
  }

  async function postRecord(input: RecordComposerSubmission) {
    await api.appendRecord(project.id, input);
    showSuccess("Record posted.");
    onPosted();
    navigate(projectPaths.timeline(project.id));
  }

  if (!currentMember) {
    return (
      <PanelFrame title="Post record" backTo={projectPaths.timeline(project.id)}>
        <InlineAlert>Join this project before posting records.</InlineAlert>
      </PanelFrame>
    );
  }

  if (kind) {
    return (
      <RecordComposer
        kind={kind}
        project={project}
        currentMember={currentMember}
        categories={categories}
        transferPrefill={transferPrefill}
        title={`New ${recordComposerNouns[kind]}`}
        backTo={newRecordPath}
        submitLabel="Post"
        submittingLabel="Posting…"
        onSubmit={postRecord}
        onBack={returnToChoice}
      />
    );
  }

  return (
    <PanelFrame title="New record" backTo={projectPaths.timeline(project.id)}>
      <Stack spacing={1.25}>
        <RecordTypeButton
          icon={<ReceiptLongIcon />}
          title="Group spend"
          description="Split a bill across members."
          onClick={() => setKind("expense")}
        />
        <RecordTypeButton
          icon={<SwapHorizIcon />}
          title="Transfer"
          description="Record money paid from one member to another."
          onClick={() => setKind("transfer")}
        />
        <RecordTypeButton
          icon={<HandshakeIcon />}
          title="Promise"
          description="Record money one member should pay another."
          onClick={() => setKind("promise")}
        />
        <RecordTypeButton
          icon={<BalanceOutlinedIcon />}
          title="Settle up"
          description="Review the transfers that settle the current balances."
          onClick={() => navigate(projectPaths.settle(project.id))}
        />
      </Stack>
    </PanelFrame>
  );
}

function RecordTypeButton({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        alignItems: "center",
        border: `1px solid ${ledgerColors.line}`,
        borderRadius: 1,
        display: "grid",
        gap: 1.5,
        gridTemplateColumns: "44px minmax(0, 1fr) 24px",
        justifyContent: "stretch",
        p: 1.5,
        textAlign: "left",
        width: "100%",
        bgcolor: ledgerColors.paperSoft,
        transition: "background-color 160ms ease, border-color 160ms ease",
        "&:hover": {
          bgcolor: "rgba(24, 23, 19, 0.035)",
          borderColor: ledgerColors.lineStrong,
        },
        "&:focus-visible": {
          outline: `2px solid ${ledgerColors.blue}`,
          outlineOffset: 2,
        },
      }}
    >
      <Stack
        sx={{
          alignItems: "center",
          bgcolor: ledgerColors.paper,
          border: `1px solid ${ledgerColors.line}`,
          borderRadius: 1,
          color: ledgerColors.ink,
          height: 44,
          justifyContent: "center",
          width: 44,
        }}
      >
        {icon}
      </Stack>
      <Stack sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 750 }}>{title}</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 14 }}>
          {description}
        </Typography>
      </Stack>
      <KeyboardArrowRightIcon sx={{ color: "text.secondary" }} />
    </ButtonBase>
  );
}
