import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import BlockIcon from "@mui/icons-material/Block";
import CheckIcon from "@mui/icons-material/Check";
import DeleteIcon from "@mui/icons-material/Delete";
import PeopleIcon from "@mui/icons-material/People";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SecurityIcon from "@mui/icons-material/Security";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  Link as MuiLink,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

import * as api from "../api";
import { BrandLink } from "../components/BrandLink";
import { InlineAlert } from "../components/InlineAlert";
import { paperFrameSx } from "../components/styles";
import { formatRelativeTime } from "../domain";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const ADMIN_PAGE_LIMIT = 25;
const MAX_BLOCKED_EMAIL_PATTERNS = 100;
const MAX_BLOCKED_EMAIL_PATTERN_LENGTH = 512;
const MAX_BLOCKED_EMAIL_REASON_LENGTH = 256;

const projectSortOptions: Array<{ value: api.AdminProjectSort; label: string }> = [
  { value: "records_desc", label: "Most records" },
  { value: "updated_desc", label: "Most recently updated" },
  { value: "updated_asc", label: "Least recently updated" },
];

const sections = [
  { label: "Projects", path: "/admin/projects", icon: <AddIcon fontSize="small" /> },
  { label: "Users", path: "/admin/users", icon: <PeopleIcon fontSize="small" /> },
  { label: "Limits", path: "/admin/limit", icon: <SecurityIcon fontSize="small" /> },
  {
    label: "Blocked emails",
    path: "/admin/blocked-emails",
    icon: <BlockIcon fontSize="small" />,
  },
] as const;

type Loadable<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

type LimitSource = "Built In" | "Default" | "User";
type LimitDraftDocument = Partial<Record<api.LimitName, string>>;

interface AdminLimitsData {
  schema: api.AdminLimitDefinition[];
  builtIn: api.Limits;
  global: api.LimitsDocument;
  current: api.LimitsDocument;
}

export default function AdminApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentSection = useMemo(
    () =>
      sections.find(
        (section) =>
          location.pathname === section.path || location.pathname.startsWith(`${section.path}/`),
      ) ?? sections[0],
    [location.pathname],
  );
  const [identity, setIdentity] = useState<Loadable<Awaited<ReturnType<typeof api.adminWhoami>>>>({
    status: "loading",
    data: null,
    error: null,
  });
  useDocumentTitle("Admin - Seisan");

  useEffect(() => {
    let active = true;
    api
      .adminWhoami()
      .then((data) => {
        if (active) {
          setIdentity({ status: "ready", data, error: null });
        }
      })
      .catch(() => {
        if (active) {
          setIdentity({ status: "error", data: null, error: "Could not verify admin access." });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function selectSection(event: SelectChangeEvent) {
    navigate(event.target.value);
  }

  return (
    <Box component="main" sx={{ minHeight: "100svh", px: { xs: 2, md: 3 }, py: 3 }}>
      <Stack spacing={3} sx={{ width: "min(1180px, 100%)", mx: "auto" }}>
        <Stack
          component="header"
          direction={{ xs: "column", sm: "row" }}
          sx={{
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "space-between",
            gap: 2,
          }}
        >
          <Box>
            <BrandLink sx={{ mb: 1 }} />
            <Typography variant="h1">Admin</Typography>
          </Box>
          {identity.status === "ready" ? (
            <Chip
              label={identity.data.local ? "Local admin" : (identity.data.email ?? "Admin")}
              sx={{ alignSelf: { xs: "start", sm: "center" } }}
            />
          ) : null}
        </Stack>

        {identity.status === "loading" ? <CircularProgress size={24} /> : null}
        {identity.status === "error" ? <InlineAlert>{identity.error}</InlineAlert> : null}

        {identity.status === "ready" ? (
          <>
            <FormControl sx={{ display: { xs: "block", md: "none" } }}>
              <InputLabel id="admin-section-label">Section</InputLabel>
              <Select
                labelId="admin-section-label"
                label="Section"
                value={currentSection.path}
                onChange={selectSection}
                fullWidth
              >
                {sections.map((section) => (
                  <MenuItem key={section.path} value={section.path}>
                    {section.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "220px minmax(0, 1fr)" },
                gap: 2,
              }}
            >
              <AdminNav currentSection={currentSection} />

              <Routes>
                <Route index element={<Navigate to="projects" replace />} />
                <Route path="projects" element={<AdminProjectsPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="limit" element={<AdminLimitsPage target="default" />} />
                <Route path="limit/:email" element={<AdminUserLimitsRoute />} />
                <Route path="blocked-emails" element={<AdminBlockedEmailsPage />} />
                <Route path="*" element={<Navigate to="/admin/projects" replace />} />
              </Routes>
            </Box>
          </>
        ) : null}
      </Stack>
    </Box>
  );
}

type BlockedEmailTestState =
  | { status: "idle"; result: null; error: null }
  | { status: "loading"; result: null; error: null }
  | { status: "ready"; result: api.AdminBlockedEmailTestResult; error: null }
  | { status: "error"; result: null; error: string };

interface BlockedEmailRuleDraft {
  id: string;
  pattern: string;
  reason: string;
}

function AdminBlockedEmailsPage() {
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
  const [testState, setTestState] = useState<BlockedEmailTestState>({
    status: "idle",
    result: null,
    error: null,
  });
  const dirty =
    state.status === "ready" &&
    JSON.stringify(comparableBlockedEmailDraft(draft)) !==
      JSON.stringify(
        state.data.patterns.map((rule) => ({
          pattern: rule.pattern,
          reason: rule.reason ?? "",
        })),
      );

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
      setTestState({ status: "idle", result: null, error: null });
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
                    <Box
                      key={rule.id}
                      sx={{
                        borderBottom: 1,
                        borderColor: "divider",
                        pb: 1.5,
                      }}
                    >
                      <Typography
                        color="text.secondary"
                        sx={{ mb: 1, fontSize: 12, fontWeight: 700 }}
                      >
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
                          onChange={(event) =>
                            updateBlockedEmailRuleDraft(rule.id, { pattern: event.target.value })
                          }
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
                          onChange={(event) =>
                            updateBlockedEmailRuleDraft(rule.id, { reason: event.target.value })
                          }
                          slotProps={{
                            htmlInput: { maxLength: MAX_BLOCKED_EMAIL_REASON_LENGTH },
                          }}
                          sx={{ flex: 1 }}
                        />
                        <Tooltip title="Remove rule">
                          <IconButton
                            aria-label={`Remove blocked email rule ${index + 1}`}
                            onClick={() => removeBlockedEmailRuleDraft(rule.id)}
                            sx={{ alignSelf: { xs: "flex-end", md: "center" } }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              )}
              <Button
                type="button"
                variant="outlined"
                startIcon={<AddIcon />}
                disabled={draft.length >= MAX_BLOCKED_EMAIL_PATTERNS}
                onClick={addBlockedEmailRuleDraft}
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
                    setTestState({ status: "idle", result: null, error: null });
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
                <Alert severity={testState.result.blocked ? "warning" : "success"}>
                  {testState.result.blocked ? (
                    <>
                      {testState.result.email} is blocked by pattern{" "}
                      <Box component="code">{testState.result.matchedPattern}</Box>.
                      {testState.result.reason ? (
                        <Box component="span" sx={{ display: "block", mt: 0.5 }}>
                          Reason: {testState.result.reason}
                        </Box>
                      ) : null}
                    </>
                  ) : (
                    `${testState.result.email} is supported.`
                  )}
                </Alert>
              ) : null}
              <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                Admin tests use the saved configuration immediately. Login enforcement can take up
                to five minutes to reflect a save.
              </Typography>
            </Stack>

            <Snackbar
              open={savedOpen}
              autoHideDuration={3000}
              onClose={() => setSavedOpen(false)}
              anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            >
              <Alert severity="success" variant="filled">
                Saved.
              </Alert>
            </Snackbar>
          </>
        ) : null}
      </Stack>
    </AdminSurface>
  );

  function updateBlockedEmailRuleDraft(
    id: string,
    patch: Partial<Pick<BlockedEmailRuleDraft, "pattern" | "reason">>,
  ) {
    setDraft((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
    clearBlockedEmailFeedback();
  }

  function addBlockedEmailRuleDraft() {
    if (draft.length >= MAX_BLOCKED_EMAIL_PATTERNS) {
      return;
    }
    setDraft((current) => [...current, createBlockedEmailRuleDraft()]);
    clearBlockedEmailFeedback();
  }

  function removeBlockedEmailRuleDraft(id: string) {
    setDraft((current) => current.filter((rule) => rule.id !== id));
    clearBlockedEmailFeedback();
  }

  function clearBlockedEmailFeedback() {
    setSaveError(null);
    setSavedOpen(false);
    setTestState({ status: "idle", result: null, error: null });
  }
}

function createBlockedEmailRuleDraft(rule?: api.BlockedEmailRule): BlockedEmailRuleDraft {
  return {
    id: crypto.randomUUID(),
    pattern: rule?.pattern ?? "",
    reason: rule?.reason ?? "",
  };
}

function documentToBlockedEmailDraft(document: api.BlockedEmailsDocument) {
  return document.patterns.map(createBlockedEmailRuleDraft);
}

function comparableBlockedEmailDraft(draft: BlockedEmailRuleDraft[]) {
  return draft.map(({ pattern, reason }) => ({ pattern, reason }));
}

function parseBlockedEmailDraft(
  draft: BlockedEmailRuleDraft[],
): { ok: true; document: api.BlockedEmailsDocument } | { ok: false; error: string } {
  const patterns: api.BlockedEmailRule[] = [];
  for (const [index, rule] of draft.entries()) {
    const pattern = rule.pattern.trim();
    const reason = rule.reason.trim();
    if (!pattern && !reason) {
      continue;
    }
    if (!pattern) {
      return { ok: false, error: `Rule ${index + 1} needs a regex pattern.` };
    }
    if (pattern.length > MAX_BLOCKED_EMAIL_PATTERN_LENGTH) {
      return {
        ok: false,
        error: `Rule ${index + 1} pattern exceeds ${MAX_BLOCKED_EMAIL_PATTERN_LENGTH} characters.`,
      };
    }
    try {
      new RegExp(pattern, "iu");
    } catch {
      return { ok: false, error: `Rule ${index + 1} has an invalid regex pattern.` };
    }
    if (/[\r\n]/u.test(reason)) {
      return { ok: false, error: `Rule ${index + 1} reason must be a single line.` };
    }
    if (reason.length > MAX_BLOCKED_EMAIL_REASON_LENGTH) {
      return {
        ok: false,
        error: `Rule ${index + 1} reason exceeds ${MAX_BLOCKED_EMAIL_REASON_LENGTH} characters.`,
      };
    }
    patterns.push({ pattern, ...(reason ? { reason } : {}) });
  }

  if (patterns.length > MAX_BLOCKED_EMAIL_PATTERNS) {
    return {
      ok: false,
      error: `Enter no more than ${MAX_BLOCKED_EMAIL_PATTERNS} patterns.`,
    };
  }
  return { ok: true, document: { version: 1, patterns } };
}

function AdminNav({ currentSection }: { currentSection: (typeof sections)[number] }) {
  return (
    <Paper
      square
      component="nav"
      sx={{ ...paperFrameSx, display: { xs: "none", md: "block" }, alignSelf: "start", p: 1 }}
    >
      <Stack spacing={0.5}>
        {sections.map((section) => {
          const selected = currentSection.path === section.path;
          return (
            <Button
              key={section.path}
              component={Link}
              to={section.path}
              startIcon={section.icon}
              variant={selected ? "contained" : "text"}
              sx={{ justifyContent: "flex-start" }}
            >
              {section.label}
            </Button>
          );
        })}
      </Stack>
    </Paper>
  );
}

function AdminUserLimitsRoute() {
  const { email = "" } = useParams();
  return <AdminLimitsPage key={email} target="user" email={email} />;
}

function AdminLimitsPage({
  target,
  email,
}: { target: "default"; email?: never } | { target: "user"; email: string }) {
  const navigate = useNavigate();
  const [emailInput, setEmailInput] = useState("");
  const [state, setState] = useState<Loadable<AdminLimitsData>>({
    status: "loading",
    data: null,
    error: null,
  });
  const [draft, setDraft] = useState<LimitDraftDocument>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const title = target === "default" ? "Default limit" : email;

  useEffect(() => {
    let active = true;
    loadAdminLimitsData(target, email)
      .then((data) => {
        if (active) {
          setState({ status: "ready", data, error: null });
          setDraft(documentToLimitDraft(data.schema, data.current));
        }
      })
      .catch(() => {
        if (active) {
          setState({ status: "error", data: null, error: "Could not load limits." });
          setDraft({});
        }
      });
    return () => {
      active = false;
    };
  }, [email, target]);

  function submitEmail(event: FormEvent) {
    event.preventDefault();
    const trimmed = emailInput.trim();
    if (trimmed) {
      setSaveError(null);
      setSavedOpen(false);
      navigate(`/admin/limit/${encodeURIComponent(trimmed)}`);
    }
  }

  async function saveLimits(event: FormEvent) {
    event.preventDefault();
    if (state.status !== "ready") {
      return;
    }

    const built = buildLimitsDocument(state.data.schema, draft);
    if (!built.ok) {
      setSaveError(built.error);
      setSavedOpen(false);
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSavedOpen(false);
    try {
      if (target === "default") {
        await api.putAdminDefaultLimits(built.document);
      } else {
        await api.putAdminUserLimits(email, built.document);
      }
      setDraft(documentToLimitDraft(state.data.schema, built.document));
      setSavedOpen(true);
    } catch {
      setSaveError("Could not save limits.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminSurface title={title}>
      <Stack spacing={2.5}>
        <Stack
          component="form"
          direction={{ xs: "column", sm: "row" }}
          spacing={1.25}
          onSubmit={submitEmail}
        >
          <TextField
            label="User email"
            type="email"
            value={emailInput}
            onChange={(event) => setEmailInput(event.target.value)}
            sx={{ flex: 1 }}
          />
          <Button type="submit" variant="outlined" startIcon={<AddIcon />}>
            Open
          </Button>
        </Stack>
        <Divider />
        {state.status === "loading" ? <CircularProgress size={24} /> : null}
        {state.status === "error" ? <InlineAlert>{state.error}</InlineAlert> : null}
        {state.status === "ready" ? (
          <Stack component="form" spacing={1.5} onSubmit={(event) => void saveLimits(event)}>
            <TableFrame>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell>Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.data.schema.map((definition) => {
                    const source = getLimitSource(definition.name, target, draft, state.data);
                    const value = getLimitValue(definition, target, draft, state.data);
                    const canRevert = draft[definition.name] !== undefined;
                    return (
                      <TableRow key={definition.name} hover>
                        <TableCell>{definition.name}</TableCell>
                        <TableCell>
                          <LimitSourceChip source={source} />
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                            <LimitValueInput
                              definition={definition}
                              value={value}
                              onChange={(nextValue) => {
                                setSaveError(null);
                                setSavedOpen(false);
                                setDraft((current) => ({
                                  ...current,
                                  [definition.name]: nextValue,
                                }));
                              }}
                            />
                            <Tooltip title="Revert">
                              <span>
                                <IconButton
                                  aria-label={`Revert ${definition.name}`}
                                  disabled={!canRevert}
                                  onClick={() => {
                                    setSaveError(null);
                                    setSavedOpen(false);
                                    setDraft((current) => {
                                      const next = { ...current };
                                      delete next[definition.name];
                                      return next;
                                    });
                                  }}
                                >
                                  <RestartAltIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableFrame>
            {saveError ? <InlineAlert>{saveError}</InlineAlert> : null}
            <Button
              type="submit"
              variant="contained"
              startIcon={<CheckIcon />}
              disabled={saving}
              sx={{ alignSelf: "start" }}
            >
              Save
            </Button>
            <Snackbar
              open={savedOpen}
              autoHideDuration={3000}
              onClose={() => setSavedOpen(false)}
              anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            >
              <Alert severity="success" variant="filled">
                Saved.
              </Alert>
            </Snackbar>
          </Stack>
        ) : null}
      </Stack>
    </AdminSurface>
  );
}

async function loadAdminLimitsData(
  target: "default" | "user",
  email: string | undefined,
): Promise<AdminLimitsData> {
  if (target === "user") {
    if (!email) {
      throw new Error("Missing user email.");
    }
    const [schema, builtIn, global, current] = await Promise.all([
      api.getAdminLimitSchema(),
      api.getAdminBuiltInLimits(),
      api.getAdminDefaultLimits(),
      api.getAdminUserLimits(email),
    ]);
    return { schema, builtIn, global, current };
  }

  const [schema, builtIn, current] = await Promise.all([
    api.getAdminLimitSchema(),
    api.getAdminBuiltInLimits(),
    api.getAdminDefaultLimits(),
  ]);
  return { schema, builtIn, global: current, current };
}

function documentToLimitDraft(
  schema: api.AdminLimitDefinition[],
  document: api.LimitsDocument,
): LimitDraftDocument {
  const draft: LimitDraftDocument = {};
  for (const definition of schema) {
    const value = document[definition.name];
    if (value !== undefined) {
      draft[definition.name] = formatLimitValue(value);
    }
  }
  return draft;
}

function getLimitSource(
  name: api.LimitName,
  target: "default" | "user",
  draft: LimitDraftDocument,
  data: AdminLimitsData,
): LimitSource {
  if (draft[name] !== undefined) {
    return target === "default" ? "Default" : "User";
  }
  if (target === "user" && data.global[name] !== undefined) {
    return "Default";
  }
  return "Built In";
}

function getLimitValue(
  definition: api.AdminLimitDefinition,
  target: "default" | "user",
  draft: LimitDraftDocument,
  data: AdminLimitsData,
): string {
  const { name } = definition;
  const currentValue = draft[name];
  if (currentValue !== undefined) {
    return currentValue;
  }

  if (target === "user") {
    const globalValue = data.global[name];
    if (globalValue !== undefined) {
      return formatLimitValue(globalValue);
    }
  }
  return formatLimitValue(data.builtIn[name]);
}

function LimitSourceChip({ source }: { source: LimitSource }) {
  return (
    <Chip
      size="small"
      label={source}
      color={source === "Default" ? "primary" : source === "User" ? "success" : "default"}
    />
  );
}

function buildLimitsDocument(
  schema: api.AdminLimitDefinition[],
  draft: LimitDraftDocument,
): { ok: true; document: api.LimitsDocument } | { ok: false; error: string } {
  const document: api.LimitsDocument = {};
  for (const definition of schema) {
    const rawValue = draft[definition.name];
    if (rawValue === undefined) {
      continue;
    }

    const parsed = parseLimitDraftValue(definition, rawValue);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    document[definition.name] = parsed.value;
  }
  return { ok: true, document };
}

function parseLimitDraftValue(
  definition: api.AdminLimitDefinition,
  value: string,
): { ok: true; value: api.LimitValue } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (definition.type === "boolean") {
    if (trimmed === "true") {
      return { ok: true, value: true };
    }
    if (trimmed === "false") {
      return { ok: true, value: false };
    }
    return { ok: false, error: `${definition.name} must be true or false.` };
  }

  if (!/^-?\d+$/u.test(trimmed)) {
    return { ok: false, error: `${definition.name} must be an integer.` };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return { ok: false, error: `${definition.name} must be a safe integer.` };
  }
  return { ok: true, value: parsed };
}

function formatLimitValue(value: api.LimitValue): string {
  return String(value);
}

function LimitValueInput({
  definition,
  value,
  onChange,
}: {
  definition: api.AdminLimitDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  if (definition.type === "boolean") {
    return (
      <Select size="small" value={value} onChange={(event) => onChange(event.target.value)}>
        <MenuItem value="true">true</MenuItem>
        <MenuItem value="false">false</MenuItem>
      </Select>
    );
  }

  return (
    <TextField
      type="number"
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{
        htmlInput: {
          step: 1,
          inputMode: "numeric",
        },
      }}
      sx={{ width: { xs: 160, sm: 220 } }}
    />
  );
}

function AdminProjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerEmail = searchParams.get("ownerEmail") ?? "";
  const sort = parseProjectSort(searchParams.get("sort"));
  const offset = parseOffset(searchParams.get("offset"));
  const [state, setState] = useState<
    Loadable<{ projects: api.AdminProject[]; page: api.AdminPage }>
  >({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    api
      .listAdminProjects({
        limit: ADMIN_PAGE_LIMIT,
        offset,
        ...(ownerEmail ? { ownerEmail } : {}),
        sort,
      })
      .then((data) => {
        if (active) {
          setState({ status: "ready", data, error: null });
        }
      })
      .catch(() => {
        if (active) {
          setState({ status: "error", data: null, error: "Could not load projects." });
        }
      });
    return () => {
      active = false;
    };
  }, [offset, ownerEmail, sort]);

  function updateParams(next: {
    ownerEmail?: string;
    sort?: api.AdminProjectSort;
    offset?: number;
  }) {
    const params = new URLSearchParams(searchParams);
    if (next.ownerEmail !== undefined) {
      const trimmed = next.ownerEmail.trim();
      if (trimmed) {
        params.set("ownerEmail", trimmed);
      } else {
        params.delete("ownerEmail");
      }
      params.delete("offset");
    }
    if (next.sort !== undefined) {
      params.set("sort", next.sort);
      params.delete("recordOrder");
      params.delete("offset");
    }
    if (next.offset !== undefined) {
      if (next.offset > 0) {
        params.set("offset", String(next.offset));
      } else {
        params.delete("offset");
      }
    }
    setState({ status: "loading", data: null, error: null });
    setSearchParams(params);
  }

  function submitOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updateParams({ ownerEmail: String(data.get("ownerEmail") ?? "") });
  }

  return (
    <AdminSurface title="Projects">
      <Stack spacing={2}>
        <Stack
          component="form"
          direction={{ xs: "column", lg: "row" }}
          spacing={1.25}
          onSubmit={submitOwner}
        >
          <TextField
            key={ownerEmail}
            name="ownerEmail"
            label="Owner email"
            type="email"
            defaultValue={ownerEmail}
            sx={{ flex: 1 }}
          />
          <FormControl sx={{ minWidth: 180 }}>
            <InputLabel id="project-order-label">Order</InputLabel>
            <Select
              labelId="project-order-label"
              label="Order"
              value={sort}
              onChange={(event) =>
                updateParams({ sort: event.target.value as api.AdminProjectSort })
              }
            >
              {projectSortOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button type="submit" variant="outlined" startIcon={<CheckIcon />}>
            Filter
          </Button>
        </Stack>
        {state.status === "loading" ? <CircularProgress size={24} /> : null}
        {state.status === "error" ? <InlineAlert>{state.error}</InlineAlert> : null}
        {state.status === "ready" ? (
          <>
            <TableFrame>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Project</TableCell>
                    <TableCell>Owner</TableCell>
                    <TableCell align="right">Records</TableCell>
                    <TableCell align="right">Members</TableCell>
                    <TableCell>Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.data.projects.map((project) => (
                    <TableRow key={project.id} hover>
                      <TableCell>
                        <MuiLink component={Link} to={`/project/${project.id}`}>
                          {project.name}
                        </MuiLink>
                      </TableCell>
                      <TableCell>{project.owner}</TableCell>
                      <TableCell align="right">{project.recordCount.toLocaleString()}</TableCell>
                      <TableCell align="right">{project.memberCount.toLocaleString()}</TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: 13 }}>
                          {formatRelativeTime(project.updatedAt)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
            <Pager
              page={state.data.page}
              onOffset={(nextOffset) => updateParams({ offset: nextOffset })}
            />
          </>
        ) : null}
      </Stack>
    </AdminSurface>
  );
}

function AdminUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const offset = parseOffset(searchParams.get("offset"));
  const [state, setState] = useState<
    Loadable<{ users: api.AdminOwnerSummary[]; page: api.AdminPage }>
  >({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    api
      .listAdminUsers({ limit: ADMIN_PAGE_LIMIT, offset })
      .then((data) => {
        if (active) {
          setState({ status: "ready", data, error: null });
        }
      })
      .catch(() => {
        if (active) {
          setState({ status: "error", data: null, error: "Could not load users." });
        }
      });
    return () => {
      active = false;
    };
  }, [offset]);

  function updateOffset(nextOffset: number) {
    const params = new URLSearchParams(searchParams);
    if (nextOffset > 0) {
      params.set("offset", String(nextOffset));
    } else {
      params.delete("offset");
    }
    setState({ status: "loading", data: null, error: null });
    setSearchParams(params);
  }

  return (
    <AdminSurface title="Users">
      <Stack spacing={2}>
        {state.status === "loading" ? <CircularProgress size={24} /> : null}
        {state.status === "error" ? <InlineAlert>{state.error}</InlineAlert> : null}
        {state.status === "ready" ? (
          <>
            <TableFrame>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Owner</TableCell>
                    <TableCell align="right">Projects</TableCell>
                    <TableCell align="right">Records</TableCell>
                    <TableCell>Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.data.users.map((user) => (
                    <TableRow key={user.owner} hover>
                      <TableCell>
                        <MuiLink
                          component={Link}
                          to={`/admin/projects?ownerEmail=${encodeURIComponent(user.owner)}`}
                        >
                          {user.owner}
                        </MuiLink>
                      </TableCell>
                      <TableCell align="right">{user.projectCount.toLocaleString()}</TableCell>
                      <TableCell align="right">{user.recordCount.toLocaleString()}</TableCell>
                      <TableCell>{formatRelativeTime(user.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
            <Pager page={state.data.page} onOffset={updateOffset} />
          </>
        ) : null}
      </Stack>
    </AdminSurface>
  );
}

function AdminSurface({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper square sx={{ ...paperFrameSx, minWidth: 0, p: { xs: 2, md: 2.5 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">{title}</Typography>
        {children}
      </Stack>
    </Paper>
  );
}

function TableFrame({ children }: { children: ReactNode }) {
  return <Box sx={{ width: "100%", overflowX: "auto" }}>{children}</Box>;
}

function Pager({ page, onOffset }: { page: api.AdminPage; onOffset: (offset: number) => void }) {
  const firstItem = page.total === 0 ? 0 : page.offset + 1;
  const lastItem = Math.min(page.offset + page.limit, page.total);
  return (
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}>
      <Typography color="text.secondary" sx={{ fontSize: 13 }}>
        {firstItem}-{lastItem} of {page.total}
      </Typography>
      <Stack direction="row" spacing={1}>
        <IconButton
          aria-label="Previous page"
          disabled={page.offset === 0}
          onClick={() => onOffset(Math.max(0, page.offset - page.limit))}
        >
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <IconButton
          aria-label="Next page"
          disabled={!page.hasMore}
          onClick={() => onOffset(page.offset + page.limit)}
        >
          <ArrowBackIcon fontSize="small" sx={{ transform: "rotate(180deg)" }} />
        </IconButton>
      </Stack>
    </Stack>
  );
}

function parseOffset(value: string | null): number {
  if (!value || !/^\d+$/u.test(value)) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseProjectSort(value: string | null): api.AdminProjectSort {
  if (value === "updated_desc" || value === "updated_asc") {
    return value;
  }
  return "records_desc";
}
