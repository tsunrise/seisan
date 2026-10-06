import type * as api from "../api";

export type LimitTarget = "default" | "user";
export type LimitSource = "Built In" | "Default" | "User";

/** Raw input strings for the overrides set at the edited level; absent keys inherit. */
export type LimitDraftDocument = Partial<Record<api.LimitName, string>>;

export interface AdminLimitsData {
  schema: api.AdminLimitDefinition[];
  builtIn: api.Limits;
  /** The default-limit overrides. For the default target this is the same as `current`. */
  global: api.LimitsDocument;
  /** The overrides stored at the edited level. */
  current: api.LimitsDocument;
}

export function documentToLimitDraft(
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

/** Where the effective value comes from: this level's override, the default, or built in. */
export function getLimitSource(
  name: api.LimitName,
  target: LimitTarget,
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

export function getLimitValue(
  definition: api.AdminLimitDefinition,
  target: LimitTarget,
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

export function buildLimitsDocument(
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

export function parseLimitDraftValue(
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
