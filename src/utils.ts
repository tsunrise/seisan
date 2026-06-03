export function loginPath(location: Pick<Location, "pathname" | "search">): string {
  return `/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function parseEmailList(input: string): string[] {
  return input
    .split(/[,\n]/u)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
