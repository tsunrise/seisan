const SEISAN_TURNSTILE_SITE_KEY = "0x4AAAAAADegcnA6CPf_zRhk";

export function shouldUseLoginTurnstile(): boolean {
  return !import.meta.env.DEV;
}

export function getLoginTurnstileSiteKey(): string {
  return SEISAN_TURNSTILE_SITE_KEY;
}
