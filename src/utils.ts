export function loginPath(location: Pick<Location, "pathname" | "search">): string {
  return `/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
}

export function parseEmailList(input: string): string[] {
  return input
    .split(/[,\n]/u)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
