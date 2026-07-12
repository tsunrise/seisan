import AddIcon from "@mui/icons-material/Add";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
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
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import { getApiErrorMessage } from "../apiErrorMessages";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { ledgerColors, ledgerFonts } from "../theme";

type ExpiryChoice = "30" | "90" | "365" | "custom";
type KeyStatus = "Active" | "Expired" | "Revoked";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function ApiKeysPage() {
  const { showError, showSuccess } = useAppSnackbar();
  const [keys, setKeys] = useState<api.ApiKeyMetadata[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<api.CreatedApiKey | null>(null);
  const [label, setLabel] = useState("");
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("90");
  const [customDate, setCustomDate] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<api.ApiKeyMetadata | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  useDocumentTitle("API keys - Seisan");

  async function loadKeys() {
    setLoadError(null);
    try {
      setKeys(await api.listApiKeys());
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    }
  }

  useEffect(() => {
    let active = true;
    api
      .listApiKeys()
      .then((nextKeys) => {
        if (active) {
          setKeys(nextKeys);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(getApiErrorMessage(error));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function openCreate() {
    setLabel("");
    setExpiryChoice("90");
    setCustomDate("");
    setCreateError(null);
    setCreated(null);
    setCreateOpen(true);
  }

  function closeCreate() {
    if (creating) {
      return;
    }
    setCreateOpen(false);
    setCreated(null);
    setCreateError(null);
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    const normalizedLabel = label.trim().replace(/\s+/gu, " ");
    if (!normalizedLabel) {
      setCreateError("Enter a label for this key.");
      return;
    }

    const expiresAt = expiryTimestamp(expiryChoice, customDate);
    if (expiresAt === null) {
      setCreateError("Choose a future expiration date.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const nextCreated = await api.createApiKey({ label: normalizedLabel, expiresAt });
      setCreated(nextCreated);
      setKeys((current) => (current ? [nextCreated.key, ...current] : [nextCreated.key]));
      showSuccess("API key created.");
    } catch (error) {
      setCreateError(getApiErrorMessage(error));
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
      setCreateError("Could not copy the API key. Select and copy it manually.");
    }
  }

  async function revokeKey() {
    if (!revokeTarget || revoking) {
      return;
    }
    setRevoking(true);
    setRevokeError(null);
    try {
      await api.revokeApiKey(revokeTarget.id);
      const refreshedKeys = await api.listApiKeys();
      setKeys(refreshedKeys);
      setRevokeTarget(null);
      showSuccess("API key revoked.");
    } catch (error) {
      const message = getApiErrorMessage(error);
      setRevokeError(message);
      showError(message);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Stack spacing={{ xs: 4, md: 5 }}>
      <Stack
        component="header"
        direction={{ xs: "column", sm: "row" }}
        sx={{
          alignItems: { xs: "stretch", sm: "flex-end" },
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Box>
          <Typography
            component="h1"
            sx={{
              fontFamily: ledgerFonts.serif,
              fontSize: { xs: "2.55rem", md: "3.35rem" },
              fontWeight: 500,
              letterSpacing: "-0.045em",
              lineHeight: 1,
            }}
          >
            API keys
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1.5, maxWidth: 620, lineHeight: 1.65 }}>
            Create credentials for scripts and clients that call the Seisan API.
          </Typography>
        </Box>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button
            component={Link}
            to="/api-docs"
            variant="outlined"
            startIcon={<MenuBookOutlinedIcon />}
            sx={{ flex: { xs: "1 1 100%", sm: "0 0 auto" } }}
          >
            API docs
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openCreate}
            sx={{ flex: { xs: "1 1 100%", sm: "0 0 auto" } }}
          >
            Create key
          </Button>
        </Stack>
      </Stack>

      <Box component="section" aria-label="API keys">
        {loadError ? (
          <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
            <InlineAlert>{loadError}</InlineAlert>
            <Button variant="outlined" onClick={() => void loadKeys()}>
              Try again
            </Button>
          </Stack>
        ) : null}
        {!loadError && keys === null ? <ApiKeysSkeleton /> : null}
        {!loadError && keys?.length === 0 ? <EmptyKeys onCreate={openCreate} /> : null}
        {!loadError && keys && keys.length > 0 ? (
          <>
            <Box sx={{ display: { xs: "none", md: "block" } }}>
              <ApiKeysTable keys={keys} onRevoke={setRevokeTarget} />
            </Box>
            <Stack
              sx={{
                display: { xs: "flex", md: "none" },
                borderTop: `1px solid ${ledgerColors.line}`,
              }}
            >
              {keys.map((key) => (
                <MobileKeyRow key={key.id} apiKey={key} onRevoke={setRevokeTarget} />
              ))}
            </Stack>
          </>
        ) : null}
      </Box>

      <Dialog open={createOpen} onClose={closeCreate} fullWidth maxWidth="sm">
        {created ? (
          <CreatedKeyView
            created={created}
            error={createError}
            onCopy={() => void copyCreatedKey()}
            onClose={closeCreate}
          />
        ) : (
          <Box component="form" onSubmit={(event) => void submitCreate(event)}>
            <DialogTitle>Create API key</DialogTitle>
            <DialogContent>
              <Stack spacing={2.25} sx={{ pt: 0.75 }}>
                <DialogContentText>
                  Give the key a label that describes where it will be used.
                </DialogContentText>
                {createError ? <InlineAlert>{createError}</InlineAlert> : null}
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
              <Button onClick={closeCreate} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" variant="contained" disabled={creating}>
                {creating ? "Creating…" : "Create key"}
              </Button>
            </DialogActions>
          </Box>
        )}
      </Dialog>

      <Dialog
        open={revokeTarget !== null}
        onClose={() => {
          if (!revoking) {
            setRevokeTarget(null);
            setRevokeError(null);
          }
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Revoke API key?</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <DialogContentText>
              {revokeTarget ? (
                <>
                  <strong>{revokeTarget.label}</strong> will stop authenticating API requests. This
                  cannot be undone.
                </>
              ) : null}
            </DialogContentText>
            {revokeError ? <InlineAlert>{revokeError}</InlineAlert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={revoking} onClick={() => setRevokeTarget(null)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={revoking}
            onClick={() => void revokeKey()}
          >
            {revoking ? "Revoking…" : "Revoke key"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function ApiKeysTable({
  keys,
  onRevoke,
}: {
  keys: api.ApiKeyMetadata[];
  onRevoke: (key: api.ApiKeyMetadata) => void;
}) {
  return (
    <TableContainer sx={{ borderBlock: `1px solid ${ledgerColors.line}` }}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Label</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Key ID</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Expires</TableCell>
            <TableCell align="right">Action</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {keys.map((key) => (
            <TableRow key={key.id} hover>
              <TableCell sx={{ fontWeight: 750 }}>{key.label}</TableCell>
              <TableCell>
                <StatusLabel status={keyStatus(key)} />
              </TableCell>
              <TableCell sx={{ fontFamily: ledgerFonts.mono, fontSize: 12.5 }}>
                {shortKeyId(key.id)}
              </TableCell>
              <TableCell>{formatDate(key.createdAt)}</TableCell>
              <TableCell>{formatDate(key.expiresAt)}</TableCell>
              <TableCell align="right">
                {key.revokedAt === null ? (
                  <Tooltip title={`Revoke ${key.label}`}>
                    <IconButton
                      aria-label={`Revoke ${key.label}`}
                      size="small"
                      onClick={() => onRevoke(key)}
                    >
                      <DeleteOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                    —
                  </Typography>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function MobileKeyRow({
  apiKey,
  onRevoke,
}: {
  apiKey: api.ApiKeyMetadata;
  onRevoke: (key: api.ApiKeyMetadata) => void;
}) {
  return (
    <Box sx={{ borderBottom: `1px solid ${ledgerColors.line}`, py: 2.25 }}>
      <Stack
        direction="row"
        sx={{ alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800 }}>{apiKey.label}</Typography>
          <Typography
            color="text.secondary"
            sx={{ mt: 0.5, fontFamily: ledgerFonts.mono, fontSize: 12 }}
          >
            {shortKeyId(apiKey.id)}
          </Typography>
        </Box>
        <StatusLabel status={keyStatus(apiKey)} />
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mt: 2 }}>
        <Metadata label="Created" value={formatDate(apiKey.createdAt)} />
        <Metadata label="Expires" value={formatDate(apiKey.expiresAt)} />
      </Box>
      {apiKey.revokedAt === null ? (
        <Button
          variant="text"
          color="error"
          startIcon={<DeleteOutlinedIcon />}
          onClick={() => onRevoke(apiKey)}
          sx={{ mt: 1.5, px: 0 }}
        >
          Revoke
        </Button>
      ) : null}
    </Box>
  );
}

function CreatedKeyView({
  created,
  error,
  onCopy,
  onClose,
}: {
  created: api.CreatedApiKey;
  error: string | null;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
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
          <Button variant="outlined" startIcon={<ContentCopyOutlinedIcon />} onClick={onCopy}>
            Copy API key
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </>
  );
}

function EmptyKeys({ onCreate }: { onCreate: () => void }) {
  return (
    <Stack
      sx={{
        alignItems: "flex-start",
        borderBlock: `1px solid ${ledgerColors.line}`,
        py: { xs: 4, sm: 5 },
      }}
    >
      <KeyOutlinedIcon sx={{ color: "text.secondary", mb: 2, fontSize: 30 }} />
      <Typography variant="h2">No API keys yet</Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 2.5, maxWidth: 520 }}>
        Create a key when a script or client needs to access Seisan without a browser session.
      </Typography>
      <Button variant="outlined" startIcon={<AddIcon />} onClick={onCreate}>
        Create key
      </Button>
    </Stack>
  );
}

function ApiKeysSkeleton() {
  return (
    <Stack spacing={0} sx={{ borderBlock: `1px solid ${ledgerColors.line}` }}>
      {[0, 1, 2].map((row) => (
        <Stack
          key={row}
          direction="row"
          sx={{
            alignItems: "center",
            gap: 3,
            py: 2,
            borderBottom: row < 2 ? `1px solid ${ledgerColors.line}` : 0,
          }}
        >
          <Skeleton width="28%" />
          <Skeleton width="15%" />
          <Skeleton width="22%" />
          <Skeleton width="18%" />
        </Stack>
      ))}
    </Stack>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography color="text.secondary" sx={{ fontSize: 11.5, fontWeight: 800 }}>
        {label}
      </Typography>
      <Typography sx={{ mt: 0.35, fontSize: 13.5 }}>{value}</Typography>
    </Box>
  );
}

function StatusLabel({ status }: { status: KeyStatus }) {
  const color =
    status === "Active"
      ? ledgerColors.green
      : status === "Revoked"
        ? ledgerColors.red
        : ledgerColors.muted;
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, color, whiteSpace: "nowrap" }}>
      <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "currentColor" }} />
      <Typography sx={{ color: "inherit", fontSize: 13, fontWeight: 750 }}>{status}</Typography>
    </Stack>
  );
}

function keyStatus(key: api.ApiKeyMetadata): KeyStatus {
  if (key.revokedAt !== null) return "Revoked";
  if (key.expiresAt <= Math.floor(Date.now() / 1000)) return "Expired";
  return "Active";
}

function shortKeyId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function formatDate(timestampSeconds: number): string {
  return dateFormatter.format(new Date(timestampSeconds * 1000));
}

function expiryTimestamp(choice: ExpiryChoice, customDate: string): number | null {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (choice !== "custom") return nowSeconds + Number(choice) * 86_400;
  if (!customDate) return null;
  const timestamp = Math.floor(new Date(`${customDate}T23:59:59`).getTime() / 1000);
  return Number.isSafeInteger(timestamp) && timestamp > nowSeconds ? timestamp : null;
}

function tomorrowDateInput(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const day = String(tomorrow.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
