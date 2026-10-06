import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import type { Loadable } from "../types";
import { AdminSurface, SavedSnackbar } from "./AdminLayout";
import {
  blockedEmailDraftIsDirty,
  createBlockedEmailRuleDraft,
  documentToBlockedEmailDraft,
  MAX_BLOCKED_EMAIL_PATTERN_LENGTH,
  MAX_BLOCKED_EMAIL_PATTERNS,
  MAX_BLOCKED_EMAIL_REASON_LENGTH,
  parseBlockedEmailDraft,
  type BlockedEmailRuleDraft,
} from "./blockedEmailsDraft";

type BlockedEmailTestState =
  | { status: "idle"; result: null; error: null }
  | { status: "loading"; result: null; error: null }
  | { status: "ready"; result: api.AdminBlockedEmailTestResult; error: null }
  | { status: "error"; result: null; error: string };

const IDLE_TEST: BlockedEmailTestState = { status: "idle", result: null, error: null };

/**
 * Edits the ordered blocked-email regex rules. The test form checks the saved configuration, so it
 * is disabled until pending edits are saved.
 */
export function AdminBlockedEmailsPage() {
  const [state, setState] = useState<Loadable<api.BlockedEmailsDocument>>({
    status: "loading",
    data: null,
    error: null,
  });
  const [draft, setDraft] = useState<BlockedEmailRuleDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testState, setTestState] = useState<BlockedEmailTestState>(IDLE_TEST);
  const dirty = state.status === "ready" && blockedEmailDraftIsDirty(draft, state.data);

  useEffect(() => {
    let active = true;
    api
      .getAdminBlockedEmails()
      .then((document) => {
        if (active) {
          setState({ status: "ready", data: document, error: null });
          setDraft(documentToBlockedEmailDraft(document));
        }
      })
      .catch(() => {
        if (active) {
          setState({
            status: "error",
            data: null,
            error: "Could not load blocked email patterns.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function clearFeedback() {
    setSaveError(null);
    setSavedOpen(false);
    setTestState(IDLE_TEST);
  }

  function updateRule(
    id: string,
    patch: Partial<Pick<BlockedEmailRuleDraft, "pattern" | "reason">>,
  ) {
    setDraft((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
    clearFeedback();
  }

  function addRule() {
    if (draft.length >= MAX_BLOCKED_EMAIL_PATTERNS) {
      return;
    }
    setDraft((current) => [...current, createBlockedEmailRuleDraft()]);
    clearFeedback();
  }

  function removeRule(id: string) {
    setDraft((current) => current.filter((rule) => rule.id !== id));
    clearFeedback();
  }

  async function savePatterns(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready") {
      return;
    }

    const parsed = parseBlockedEmailDraft(draft);
    if (!parsed.ok) {
      setSaveError(parsed.error);
      setSavedOpen(false);
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSavedOpen(false);
    try {
      await api.putAdminBlockedEmails(parsed.document);
      setState({ status: "ready", data: parsed.document, error: null });
      setDraft(documentToBlockedEmailDraft(parsed.document));
      setTestState(IDLE_TEST);
      setSavedOpen(true);
    } catch {
      setSaveError("Could not save blocked email patterns.");
    } finally {
      setSaving(false);
    }
  }

  async function submitTestEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dirty) {
      return;
    }

    setTestState({ status: "loading", result: null, error: null });
    try {
      const result = await api.testAdminBlockedEmail(testEmail);
      setTestState({ status: "ready", result, error: null });
    } catch {
      setTestState({
        status: "error",
        result: null,
        error: "Could not test this email.",
      });
    }
  }

  return (
    <AdminSurface title="Blocked emails">
      <Stack spacing={2.5}>
        {state.status === "loading" ? <CircularProgress size={24} /> : null}
        {state.status === "error" ? <InlineAlert>{state.error}</InlineAlert> : null}
        {state.status === "ready" ? (
          <>
            <Stack component="form" spacing={1.5} onSubmit={(event) => void savePatterns(event)}>
              {draft.length === 0 ? (
                <Typography color="text.secondary">No blocked email rules configured.</Typography>
              ) : (
                <Stack spacing={1.5}>
                  {draft.map((rule, index) => (
                    <BlockedEmailRuleRow
                      key={rule.id}
                      rule={rule}
                      index={index}
                      onChange={(patch) => updateRule(rule.id, patch)}
                      onRemove={() => removeRule(rule.id)}
                    />
                  ))}
                </Stack>
              )}
              <Button
                type="button"
                variant="outlined"
                startIcon={<AddIcon />}
                disabled={draft.length >= MAX_BLOCKED_EMAIL_PATTERNS}
                onClick={addRule}
                sx={{ alignSelf: "start" }}
              >
                Add rule
              </Button>
              <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                Emails are normalized to lowercase and tested with case-insensitive Unicode regexes.
                Use ^ and $ to match the complete address. Reasons are optional and shown to blocked
                users.
              </Typography>
              {saveError ? <InlineAlert>{saveError}</InlineAlert> : null}
              <Button
                type="submit"
                variant="contained"
                startIcon={<CheckIcon />}
                disabled={saving || !dirty}
                sx={{ alignSelf: "start" }}
              >
                Save
              </Button>
            </Stack>

            <Divider />

            <Stack component="form" spacing={1.5} onSubmit={(event) => void submitTestEmail(event)}>
              <Typography variant="h3">Test an email</Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                <TextField
                  label="Email"
                  type="email"
                  required
                  value={testEmail}
                  onChange={(event) => {
                    setTestEmail(event.target.value);
                    setTestState(IDLE_TEST);
                  }}
                  sx={{ flex: 1 }}
                />
                <Button
                  type="submit"
                  variant="outlined"
                  disabled={dirty || testState.status === "loading"}
                  sx={{ alignSelf: { xs: "stretch", sm: "center" } }}
                >
                  Test
                </Button>
              </Stack>
              {dirty ? (
                <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                  Save changes before testing them.
                </Typography>
              ) : null}
              {testState.status === "loading" ? <CircularProgress size={20} /> : null}
              {testState.status === "error" ? <InlineAlert>{testState.error}</InlineAlert> : null}
              {testState.status === "ready" ? (
                <BlockedEmailTestResult result={testState.result} />
              ) : null}
              <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                Admin tests use the saved configuration immediately. Login enforcement can take up
                to five minutes to reflect a save.
              </Typography>
            </Stack>

            <SavedSnackbar open={savedOpen} onClose={() => setSavedOpen(false)} />
          </>
        ) : null}
      </Stack>
    </AdminSurface>
  );
}

function BlockedEmailRuleRow({
  rule,
  index,
  onChange,
  onRemove,
}: {
  rule: BlockedEmailRuleDraft;
  index: number;
  onChange: (patch: Partial<Pick<BlockedEmailRuleDraft, "pattern" | "reason">>) => void;
  onRemove: () => void;
}) {
  return (
    <Box
      sx={{
        borderBottom: 1,
        borderColor: "divider",
        pb: 1.5,
      }}
    >
      <Typography color="text.secondary" sx={{ mb: 1, fontSize: 12, fontWeight: 700 }}>
        Rule {index + 1}
      </Typography>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.25}
        sx={{ alignItems: { xs: "stretch", md: "flex-start" } }}
      >
        <TextField
          label="Regex pattern"
          value={rule.pattern}
          onChange={(event) => onChange({ pattern: event.target.value })}
          slotProps={{
            htmlInput: {
              maxLength: MAX_BLOCKED_EMAIL_PATTERN_LENGTH,
              spellCheck: false,
            },
          }}
          sx={{ flex: 1.2, "& input": { fontFamily: "monospace" } }}
        />
        <TextField
          label="Reason (optional)"
          value={rule.reason}
          onChange={(event) => onChange({ reason: event.target.value })}
          slotProps={{
            htmlInput: { maxLength: MAX_BLOCKED_EMAIL_REASON_LENGTH },
          }}
          sx={{ flex: 1 }}
        />
        <Tooltip title="Remove rule">
          <IconButton
            aria-label={`Remove blocked email rule ${index + 1}`}
            onClick={onRemove}
            sx={{ alignSelf: { xs: "flex-end", md: "center" } }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

function BlockedEmailTestResult({ result }: { result: api.AdminBlockedEmailTestResult }) {
  return (
    <Alert severity={result.blocked ? "warning" : "success"}>
      {result.blocked ? (
        <>
          {result.email} is blocked by pattern <Box component="code">{result.matchedPattern}</Box>.
          {result.reason ? (
            <Box component="span" sx={{ display: "block", mt: 0.5 }}>
              Reason: {result.reason}
            </Box>
          ) : null}
        </>
      ) : (
        `${result.email} is supported.`
      )}
    </Alert>
  );
}
