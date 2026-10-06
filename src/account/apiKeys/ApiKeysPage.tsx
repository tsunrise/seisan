import AddIcon from "@mui/icons-material/Add";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import { Box, Button, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import * as api from "../../api";
import { getApiErrorMessage } from "../../api/errorMessages";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { InlineAlert } from "../../components/InlineAlert";
import { useAppSnackbar } from "../../hooks/useAppSnackbar";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { ledgerFonts } from "../../theme";
import { ApiKeyList, ApiKeysSkeleton, EmptyKeys } from "./ApiKeyList";
import { CreateApiKeyDialog } from "./CreateApiKeyDialog";

export function ApiKeysPage() {
  const { showError, showSuccess } = useAppSnackbar();
  const [keys, setKeys] = useState<api.ApiKeyMetadata[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
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

  async function revokeKey() {
    if (!revokeTarget || revoking) {
      return;
    }
    setRevoking(true);
    setRevokeError(null);
    try {
      await api.revokeApiKey(revokeTarget.id);
      setKeys(await api.listApiKeys());
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
            onClick={() => setCreateOpen(true)}
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
        {!loadError && keys?.length === 0 ? (
          <EmptyKeys onCreate={() => setCreateOpen(true)} />
        ) : null}
        {!loadError && keys && keys.length > 0 ? (
          <ApiKeyList keys={keys} onRevoke={setRevokeTarget} />
        ) : null}
      </Box>

      <CreateApiKeyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(key) => setKeys((current) => (current ? [key, ...current] : [key]))}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke API key?"
        description={
          revokeTarget ? (
            <>
              <strong>{revokeTarget.label}</strong> will stop authenticating API requests. This
              cannot be undone.
            </>
          ) : null
        }
        confirmLabel={revoking ? "Revoking…" : "Revoke key"}
        busy={revoking}
        maxWidth="xs"
        onConfirm={() => void revokeKey()}
        onClose={() => {
          setRevokeTarget(null);
          setRevokeError(null);
        }}
      >
        {revokeError ? <InlineAlert>{revokeError}</InlineAlert> : null}
      </ConfirmDialog>
    </Stack>
  );
}
