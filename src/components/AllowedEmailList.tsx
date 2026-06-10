import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { Button, IconButton, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";

import { parseEmailList } from "../utils";

export function AllowedEmailList({
  emails,
  disabled = false,
  editable = true,
  emptyMessage = "No extra emails are allowed yet.",
  onListChange,
}: {
  emails: string[];
  disabled?: boolean;
  editable?: boolean;
  emptyMessage?: string;
  onListChange: (emails: string[]) => void | Promise<void>;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [updating, setUpdating] = useState(false);
  const canEdit = editable && !disabled && !updating;

  async function commit(nextEmails: string[]) {
    setUpdating(true);
    try {
      await onListChange(nextEmails);
    } finally {
      setUpdating(false);
    }
  }

  async function addEmails() {
    const additions = parseEmailList(newEmail).filter((email) => !emails.includes(email));
    if (additions.length === 0) {
      setNewEmail("");
      return;
    }
    try {
      await commit([...emails, ...additions]);
      setNewEmail("");
    } catch {
      return;
    }
  }

  async function removeEmail(email: string) {
    try {
      await commit(emails.filter((item) => item !== email));
    } catch {
      return;
    }
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="h2">Allowed emails</Typography>
      <Stack spacing={1}>
        {emails.length === 0 ? (
          <Typography color="text.secondary">{emptyMessage}</Typography>
        ) : null}
        {emails.map((email) => (
          <Stack
            key={email}
            direction="row"
            sx={{
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1.25,
              minHeight: 44,
              borderBottom: 1,
              borderColor: "divider",
              pb: 1,
            }}
          >
            <Typography sx={{ minWidth: 0, overflowWrap: "anywhere" }}>{email}</Typography>
            {editable ? (
              <IconButton
                color="error"
                disabled={!canEdit}
                aria-label={`Remove ${email}`}
                onClick={() => void removeEmail(email)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            ) : null}
          </Stack>
        ))}
      </Stack>
      {editable ? (
        <Stack direction={{ xs: "column", lg: "row" }} sx={{ gap: 1.25 }}>
          <TextField
            type="email"
            label="Allowed email"
            disabled={!canEdit}
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addEmails();
              }
            }}
            placeholder="name@example.com"
            sx={{ flex: 1, minWidth: 0 }}
          />
          <Button
            type="button"
            variant="outlined"
            disabled={!canEdit}
            startIcon={<AddIcon />}
            onClick={() => void addEmails()}
          >
            Add
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}
