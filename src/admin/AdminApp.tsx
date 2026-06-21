import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
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

const projectSortOptions: Array<{ value: api.AdminProjectSort; label: string }> = [
  { value: "records_desc", label: "Most records" },
  { value: "updated_desc", label: "Most recently updated" },
  { value: "updated_asc", label: "Least recently updated" },
];

const sections = [
  { label: "Projects", path: "/admin/projects", icon: <AddIcon fontSize="small" /> },
  { label: "Users", path: "/admin/users", icon: <PeopleIcon fontSize="small" /> },
  { label: "Limits", path: "/admin/limit", icon: <SecurityIcon fontSize="small" /> },
] as const;

type Loadable<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

type LimitSource = "Built In" | "Default" | "User";
type LimitDraftDocument = Partial<Record<api.LimitName, string>>;

const dateTimeLocalPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u;

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
                <Route path="*" element={<Navigate to="/admin/projects" replace />} />
              </Routes>
            </Box>
          </>
        ) : null}
      </Stack>
    </Box>
  );
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
      draft[definition.name] = formatLimitValue(definition, value);
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
      return formatLimitValue(definition, globalValue);
    }
  }
  return formatLimitValue(definition, data.builtIn[name]);
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

  if (definition.type === "option<timestamp>") {
    if (trimmed === "" || trimmed === "null") {
      return { ok: true, value: null };
    }
    const parsed = /^\d+$/u.test(trimmed) ? Number(trimmed) : parseDateTimeLocalValue(trimmed);
    if (parsed === null) {
      return { ok: false, error: `${definition.name} must be null or a timestamp.` };
    }
    if (!Number.isSafeInteger(parsed)) {
      return { ok: false, error: `${definition.name} must be a safe timestamp.` };
    }
    return { ok: true, value: parsed };
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

function formatLimitValue(definition: api.AdminLimitDefinition, value: api.LimitValue): string {
  if (definition.type === "option<timestamp>") {
    return typeof value === "number" ? formatDateTimeLocalValue(value) : "";
  }
  if (value === null) {
    return "null";
  }
  return String(value);
}

function formatDateTimeLocalValue(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isSafeInteger(timestamp) || Number.isNaN(date.getTime())) {
    return "";
  }

  const milliseconds = date.getMilliseconds();
  const fractional = milliseconds === 0 ? "" : `.${padNumber(milliseconds, 3)}`;
  return `${padNumber(date.getFullYear(), 4)}-${padNumber(date.getMonth() + 1, 2)}-${padNumber(
    date.getDate(),
    2,
  )}T${padNumber(date.getHours(), 2)}:${padNumber(date.getMinutes(), 2)}:${padNumber(
    date.getSeconds(),
    2,
  )}${fractional}`;
}

function parseDateTimeLocalValue(value: string): number | null {
  const match = dateTimeLocalPattern.exec(value);
  if (!match) {
    return null;
  }

  const [, rawYear, rawMonth, rawDay, rawHours, rawMinutes, rawSeconds = "0", rawMillis = ""] =
    match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);
  const seconds = Number(rawSeconds);
  const milliseconds = Number(rawMillis.padEnd(3, "0"));
  const date = new Date(year, month - 1, day, hours, minutes, seconds, milliseconds);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minutes ||
    date.getSeconds() !== seconds ||
    date.getMilliseconds() !== milliseconds
  ) {
    return null;
  }

  const timestamp = date.getTime();
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

function padNumber(value: number, length: number): string {
  return String(value).padStart(length, "0");
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

  if (definition.type === "option<timestamp>") {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <TextField
          type="datetime-local"
          size="small"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          slotProps={{
            htmlInput: {
              step: 0.001,
            },
          }}
          sx={{ width: { xs: 220, sm: 280 } }}
        />
        <Tooltip title="Clear">
          <span>
            <IconButton
              aria-label={`Clear ${definition.name}`}
              disabled={value === ""}
              onClick={() => onChange("")}
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
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
