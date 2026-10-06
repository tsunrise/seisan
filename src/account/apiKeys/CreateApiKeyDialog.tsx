import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from "@mui/material";
import type { FormEvent } from "react";
import { useState } from "react";

import * as api from "../../api";
import { getApiErrorMessage } from "../../api/errorMessages";
import { InlineAlert } from "../../components/InlineAlert";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import { ledgerColors, ledgerFonts } from "../../theme";
import { expiryTimestamp, tomorrowDateInput, type ExpiryChoice } from "./apiKeyFormat";

/**
 * Create-key form followed by the one-time secret view. The secret only lives in this dialog's
 * state and is discarded, with the rest of the form, when the dialog closes.
 */
export function CreateApiKeyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (key: api.ApiKeyMetadata) => void;
}) {
  const { showSuccess } = useAppSnackbar();
  const [created, setCreated] = useState<api.CreatedApiKey | null>(null);
  const [label, setLabel] = useState("");
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("90");
  const [customDate, setCustomDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function close() {
    if (creating) {
      return;
    }
    setCreated(null);
    setLabel("");
    setExpiryChoice("90");
    setCustomDate("");
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedLabel = label.trim().replace(/\s+/gu, " ");
    if (!normalizedLabel) {
      setError("Enter a label for this key.");
      return;
    }

    const expiresAt = expiryTimestamp(expiryChoice, customDate);
    if (expiresAt === null) {
      setError("Choose a future expiration date.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const nextCreated = await api.createApiKey({ label: normalizedLabel, expiresAt });
      setCreated(nextCreated);
      onCreated(nextCreated.key);
      showSuccess("API key created.");
    } catch (error) {
      setError(getApiErrorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function copyCreatedKey() {
    if (!created) {
      return;
    }
    try {
      await navigator.clipboard.writeText(created.apiKey);
      showSuccess("API key copied.");
    } catch {
      setError("Could not copy the API key. Select and copy it manually.");
    }
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      {created ? (
        <>
          <DialogTitle>Save your API key</DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <Alert severity="warning" variant="outlined">
                This is the only time Seisan will show the complete key. Store it somewhere secure.
              </Alert>
              {error ? <InlineAlert>{error}</InlineAlert> : null}
              <Box
                aria-label="Created API key"
                sx={{
                  border: `1px solid ${ledgerColors.lineStrong}`,
                  bgcolor: ledgerColors.paperSoft,
                  p: 2,
                  fontFamily: ledgerFonts.mono,
                  fontSize: 13,
                  lineHeight: 1.65,
                  overflowWrap: "anywhere",
                  userSelect: "all",
                }}
              >
                {created.apiKey}
              </Box>
              <Button
                variant="outlined"
                startIcon={<ContentCopyOutlinedIcon />}
                onClick={() => void copyCreatedKey()}
              >
                Copy API key
              </Button>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={close}>
              Done
            </Button>
          </DialogActions>
        </>
      ) : (
        <Box component="form" onSubmit={(event) => void submit(event)}>
          <DialogTitle>Create API key</DialogTitle>
          <DialogContent>
            <Stack spacing={2.25} sx={{ pt: 0.75 }}>
              <DialogContentText>
                Give the key a label that describes where it will be used.
              </DialogContentText>
              {error ? <InlineAlert>{error}</InlineAlert> : null}
              <TextField
                autoFocus
                label="Key label"
                placeholder="Expense import script"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                required
                slotProps={{ htmlInput: { maxLength: 120 } }}
              />
              <FormControl>
                <InputLabel id="api-key-expiry-label">Expiration</InputLabel>
                <Select
                  labelId="api-key-expiry-label"
                  label="Expiration"
                  value={expiryChoice}
                  onChange={(event) => setExpiryChoice(event.target.value as ExpiryChoice)}
                >
                  <MenuItem value="30">30 days</MenuItem>
                  <MenuItem value="90">90 days</MenuItem>
                  <MenuItem value="365">365 days</MenuItem>
                  <MenuItem value="custom">Custom date</MenuItem>
                </Select>
              </FormControl>
              {expiryChoice === "custom" ? (
                <TextField
                  label="Expiration date"
                  type="date"
                  value={customDate}
                  onChange={(event) => setCustomDate(event.target.value)}
                  required
                  slotProps={{
                    inputLabel: { shrink: true },
                    htmlInput: { min: tomorrowDateInput() },
                  }}
                />
              ) : null}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={close} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={creating}>
              {creating ? "Creating…" : "Create key"}
            </Button>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  );
}
