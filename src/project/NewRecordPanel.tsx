import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import { Button, Stack } from "@mui/material";
import { useState } from "react";

import type * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { PanelFrame } from "../components/PanelFrame";
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
      <Stack direction={{ xs: "column", sm: "row" }} sx={{ gap: 2 }}>
        <Button
          variant="outlined"
          startIcon={<ReceiptLongIcon />}
          onClick={() => setMode("expense")}
          sx={{ minHeight: 150, flex: 1, flexDirection: "column", fontSize: 18 }}
        >
          Group spend
        </Button>
        <Button
          variant="outlined"
          startIcon={<SwapHorizIcon />}
          onClick={() => setMode("transfer")}
          sx={{ minHeight: 150, flex: 1, flexDirection: "column", fontSize: 18 }}
        >
          Transfer
        </Button>
      </Stack>
    </PanelFrame>
  );
}
