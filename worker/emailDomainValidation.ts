import { z } from "zod";

import type { Result } from "./result";

const CLOUDFLARE_DOH_URL = "https://cloudflare-dns.com/dns-query";
const DNS_LOOKUP_TIMEOUT_MS = 2_000;

const DNS_STATUS_NOERROR = 0;
const DNS_STATUS_NXDOMAIN = 3;
const DNS_RECORD_A = 1;
const DNS_RECORD_MX = 15;
const DNS_RECORD_AAAA = 28;

const DnsAnswer = z.object({
  type: z.number().int(),
  data: z.string(),
});

const DnsResponse = z.object({
  Status: z.number().int().nonnegative(),
  TC: z.boolean(),
  Answer: z.array(DnsAnswer).optional(),
});

const Ipv4Address = z.ipv4();
const Ipv6Address = z.ipv6();
const MxExchange = z.hostname();

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type DnsRecordType = "A" | "AAAA" | "MX";
type DnsQueryResult = Result<{ records: string[] }, "lookup_failed" | "nxdomain">;

const defaultFetcher: Fetcher = (input, init) => fetch(input, init);

export class EmailDomainValidator {
  private readonly fetcher: Fetcher;

  constructor(fetcher: Fetcher = defaultFetcher) {
    this.fetcher = fetcher;
  }

  async validate(email: string): Promise<Result<void, "invalid_domain" | "lookup_failed">> {
    const domain = getEmailDomain(email);
    if (!domain) {
      return { ok: false, error: "invalid_domain" };
    }

    const mxResult = await this.query(domain, "MX", DNS_RECORD_MX);
    if (!mxResult.ok) {
      return mxResult.error === "nxdomain"
        ? { ok: false, error: "invalid_domain" }
        : { ok: false, error: "lookup_failed" };
    }

    if (mxResult.records.length > 0) {
      const mxRecords = mxResult.records.map(parseMxRecord);
      if (mxRecords.some((record) => record === "malformed")) {
        return { ok: false, error: "lookup_failed" };
      }
      if (mxRecords.some((record) => record === "null")) {
        return { ok: false, error: "invalid_domain" };
      }
      return { ok: true };
    }

    const [ipv4Result, ipv6Result] = await Promise.all([
      this.query(domain, "A", DNS_RECORD_A),
      this.query(domain, "AAAA", DNS_RECORD_AAAA),
    ]);
    const addressResults = [
      validateAddressRecords(ipv4Result, Ipv4Address),
      validateAddressRecords(ipv6Result, Ipv6Address),
    ];

    if (addressResults.some((result) => result === "present")) {
      return { ok: true };
    }
    if (addressResults.every((result) => result === "absent")) {
      return { ok: false, error: "invalid_domain" };
    }
    return { ok: false, error: "lookup_failed" };
  }

  private async query(
    domain: string,
    type: DnsRecordType,
    recordType: number,
  ): Promise<DnsQueryResult> {
    const url = new URL(CLOUDFLARE_DOH_URL);
    url.searchParams.set("name", domain);
    url.searchParams.set("type", type);

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(DNS_LOOKUP_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, error: "lookup_failed" };
    }

    if (!response.ok) {
      return { ok: false, error: "lookup_failed" };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: "lookup_failed" };
    }

    const parsed = DnsResponse.safeParse(body);
    if (!parsed.success || parsed.data.TC) {
      return { ok: false, error: "lookup_failed" };
    }
    if (parsed.data.Status === DNS_STATUS_NXDOMAIN) {
      return { ok: false, error: "nxdomain" };
    }
    if (parsed.data.Status !== DNS_STATUS_NOERROR) {
      return { ok: false, error: "lookup_failed" };
    }

    return {
      ok: true,
      records: (parsed.data.Answer ?? [])
        .filter((answer) => answer.type === recordType)
        .map((answer) => answer.data),
    };
  }
}

export function getEmailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  if (separator < 0 || separator === normalized.length - 1) {
    return null;
  }
  return normalized.slice(separator + 1);
}

function parseMxRecord(data: string): "ordinary" | "null" | "malformed" {
  const match = /^(\d{1,5})\s+(\S+)$/u.exec(data.trim());
  if (!match) {
    return "malformed";
  }

  const preference = Number(match[1]);
  const exchange = match[2];
  if (!Number.isInteger(preference) || preference > 65_535) {
    return "malformed";
  }
  if (exchange === ".") {
    return preference === 0 ? "null" : "malformed";
  }

  const hostname = exchange.endsWith(".") ? exchange.slice(0, -1) : exchange;
  return MxExchange.safeParse(hostname).success ? "ordinary" : "malformed";
}

function validateAddressRecords(
  result: DnsQueryResult,
  schema: z.ZodType<string>,
): "present" | "absent" | "unavailable" {
  if (!result.ok) {
    return result.error === "nxdomain" ? "absent" : "unavailable";
  }
  if (result.records.some((record) => !schema.safeParse(record).success)) {
    return "unavailable";
  }
  return result.records.length > 0 ? "present" : "absent";
}
