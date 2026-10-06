import AddIcon from "@mui/icons-material/Add";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import {
  Box,
  Button,
  IconButton,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";

import type * as api from "../../api";
import { ledgerColors, ledgerFonts } from "../../theme";
import { formatKeyDate, keyStatus, shortKeyId, type KeyStatus } from "./apiKeyFormat";

/** API key metadata as a table on desktop and stacked rows on mobile. */
export function ApiKeyList({
  keys,
  onRevoke,
}: {
  keys: api.ApiKeyMetadata[];
  onRevoke: (key: api.ApiKeyMetadata) => void;
}) {
  return (
    <>
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <ApiKeysTable keys={keys} onRevoke={onRevoke} />
      </Box>
      <Stack
        sx={{
          display: { xs: "flex", md: "none" },
          borderTop: `1px solid ${ledgerColors.line}`,
        }}
      >
        {keys.map((key) => (
          <MobileKeyRow key={key.id} apiKey={key} onRevoke={onRevoke} />
        ))}
      </Stack>
    </>
  );
}

export function EmptyKeys({ onCreate }: { onCreate: () => void }) {
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

export function ApiKeysSkeleton() {
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
              <TableCell>{formatKeyDate(key.createdAt)}</TableCell>
              <TableCell>{formatKeyDate(key.expiresAt)}</TableCell>
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
        <Metadata label="Created" value={formatKeyDate(apiKey.createdAt)} />
        <Metadata label="Expires" value={formatKeyDate(apiKey.expiresAt)} />
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
