import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import {
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
} from "@mui/material";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import * as api from "../api";
import { InlineAlert } from "../components/InlineAlert";
import type { Loadable } from "../types";
import { AdminSurface, SavedSnackbar, TableFrame } from "./AdminLayout";
import {
  buildLimitsDocument,
  documentToLimitDraft,
  getLimitSource,
  getLimitValue,
  type AdminLimitsData,
  type LimitDraftDocument,
  type LimitSource,
  type LimitTarget,
} from "./limitsDraft";

export function AdminUserLimitsRoute() {
  const { email = "" } = useParams();
  return <AdminLimitsPage key={email} target="user" email={email} />;
}

/**
 * Edits the default limit overrides, or one user's overrides on top of them. Each row shows where
 * its effective value comes from; reverting a row drops this level's override.
 */
export function AdminLimitsPage({
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

  function clearFeedback() {
    setSaveError(null);
    setSavedOpen(false);
  }

  function submitEmail(event: FormEvent) {
    event.preventDefault();
    const trimmed = emailInput.trim();
    if (trimmed) {
      clearFeedback();
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
    clearFeedback();
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
                  {state.data.schema.map((definition) => (
                    <TableRow key={definition.name} hover>
                      <TableCell>{definition.name}</TableCell>
                      <TableCell>
                        <LimitSourceChip
                          source={getLimitSource(definition.name, target, draft, state.data)}
                        />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                          <LimitValueInput
                            definition={definition}
                            value={getLimitValue(definition, target, draft, state.data)}
                            onChange={(nextValue) => {
                              clearFeedback();
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
                                disabled={draft[definition.name] === undefined}
                                onClick={() => {
                                  clearFeedback();
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
                  ))}
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
            <SavedSnackbar open={savedOpen} onClose={() => setSavedOpen(false)} />
          </Stack>
        ) : null}
      </Stack>
    </AdminSurface>
  );
}

async function loadAdminLimitsData(
  target: LimitTarget,
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

function LimitSourceChip({ source }: { source: LimitSource }) {
  return (
    <Chip
      size="small"
      label={source}
      color={source === "Default" ? "primary" : source === "User" ? "success" : "default"}
    />
  );
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
