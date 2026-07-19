import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import HandshakeIcon from "@mui/icons-material/Handshake";
import BalanceOutlinedIcon from "@mui/icons-material/BalanceOutlined";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { ButtonBase, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { PanelFrame } from "../components/PanelFrame";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { ledgerColors } from "../theme";
import { ExpenseComposer } from "./ExpenseComposer";
import { PromiseComposer } from "./PromiseComposer";
import { TransferComposer } from "./TransferComposer";
import { transferPrefillFromSearch } from "./transferForm";

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
  const [mode, setMode] = useState<"choice" | "expense" | "transfer" | "promise">(
    transferPrefill ? "transfer" : "choice",
  );

  function returnToChoice() {
    setMode("choice");
    if (search.size > 0) {
      navigate(`/project/${project.id}/records/new`, { replace: true });
    }
  }

  async function postRecord(input: {
    description: api.WritableRecordDescription;
    delta: api.MoneyByMemberId;
  }) {
    await api.appendRecord(project.id, input);
    showSuccess("Record posted.");
    onPosted();
    navigate(`/project/${project.id}`);
  }

  if (!currentMember) {
    return (
      <PanelFrame title="Post record" backTo={`/project/${project.id}`}>
        <InlineAlert>Join this project before posting records.</InlineAlert>
      </PanelFrame>
    );
  }

  if (mode === "expense") {
    return (
      <ExpenseComposer
        project={project}
        currentMember={currentMember}
        categories={categories}
        title="New group spend"
        backTo={`/project/${project.id}/records/new`}
        submitLabel="Post"
        submittingLabel="Posting…"
        onSubmit={postRecord}
        onBack={returnToChoice}
      />
    );
  }

  if (mode === "transfer") {
    return (
      <TransferComposer
        project={project}
        currentMember={currentMember}
        prefill={transferPrefill}
        title="New transfer"
        backTo={`/project/${project.id}/records/new`}
        submitLabel="Post"
        submittingLabel="Posting…"
        onSubmit={postRecord}
        onBack={returnToChoice}
      />
    );
  }

  if (mode === "promise") {
    return (
      <PromiseComposer
        project={project}
        currentMember={currentMember}
        title="New promise"
        backTo={`/project/${project.id}/records/new`}
        submitLabel="Post"
        submittingLabel="Posting…"
        onSubmit={postRecord}
        onBack={returnToChoice}
      />
    );
  }

  return (
    <PanelFrame title="New record" backTo={`/project/${project.id}`}>
      <Stack spacing={1.25}>
        <RecordTypeButton
          icon={<ReceiptLongIcon />}
          title="Group spend"
          description="Split a bill across members."
          onClick={() => setMode("expense")}
        />
        <RecordTypeButton
          icon={<SwapHorizIcon />}
          title="Transfer"
          description="Record money paid from one member to another."
          onClick={() => setMode("transfer")}
        />
        <RecordTypeButton
          icon={<HandshakeIcon />}
          title="Promise"
          description="Record money one member should pay another."
          onClick={() => setMode("promise")}
        />
        <RecordTypeButton
          icon={<BalanceOutlinedIcon />}
          title="Settle up"
          description="Review the transfers that settle the current balances."
          onClick={() => navigate(`/project/${project.id}/settle`)}
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
