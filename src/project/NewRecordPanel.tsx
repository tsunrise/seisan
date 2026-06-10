import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { ButtonBase, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useState } from "react";

import type * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { PanelFrame } from "../components/PanelFrame";
import { ledgerColors } from "../theme";
import { ExpenseComposer } from "./ExpenseComposer";
import { TransferComposer } from "./TransferComposer";

export function NewRecordPanel({
  project,
  currentMember,
  onPosted,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
  onPosted: () => void;
}) {
  const [mode, setMode] = useState<"choice" | "expense" | "transfer">("choice");

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
        onPosted={onPosted}
        onBack={() => setMode("choice")}
      />
    );
  }

  if (mode === "transfer") {
    return (
      <TransferComposer
        project={project}
        currentMember={currentMember}
        onPosted={onPosted}
        onBack={() => setMode("choice")}
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
        borderRadius: 2,
        display: "grid",
        gap: 1.5,
        gridTemplateColumns: "44px minmax(0, 1fr) 24px",
        justifyContent: "stretch",
        p: 1.5,
        textAlign: "left",
        width: "100%",
        "&:hover": {
          bgcolor: "rgba(232, 244, 255, 0.55)",
          borderColor: "rgba(34, 33, 31, 0.42)",
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
          bgcolor: ledgerColors.blueSoft,
          borderRadius: "50%",
          color: ledgerColors.blue,
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
