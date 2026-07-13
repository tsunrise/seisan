export interface AccountBackTarget {
  label: string;
}

export interface AccountLinkState {
  accountBackTarget: AccountBackTarget;
}

export function accountLinkState(label: string): AccountLinkState {
  return { accountBackTarget: { label } };
}

export function accountBackTarget(state: unknown): AccountBackTarget | null {
  if (!isRecord(state) || !isRecord(state.accountBackTarget)) {
    return null;
  }

  const label = state.accountBackTarget.label;
  return typeof label === "string" && label.trim() ? { label } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
