import { describe, expect, it, vi } from "vitest";

import { EmailDomainValidator, getEmailDomain } from "../worker/emailDomainValidation";

const CLOUDFLARE_DOH_URL = "https://cloudflare-dns.com/dns-query";

interface DnsAnswer {
  type: number;
  data: string;
}

function dnsResponse(status = 0, answers?: DnsAnswer[], truncated = false): Response {
  return Response.json({
    Status: status,
    TC: truncated,
    ...(answers ? { Answer: answers } : {}),
  });
}

function queryType(input: RequestInfo | URL): string | null {
  return new URL(String(input)).searchParams.get("type");
}

describe("email domain validation", () => {
  it("normalizes and extracts the email domain", () => {
    expect(getEmailDomain("  USER@Example.COM ")).toBe("example.com");
    expect(getEmailDomain("not-an-email")).toBeNull();
    expect(getEmailDomain("user@")).toBeNull();
  });

  it("accepts ordinary MX records and sends the expected Cloudflare DoH request", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(`${url.origin}${url.pathname}`).toBe(CLOUDFLARE_DOH_URL);
      expect(url.searchParams.get("name")).toBe("example.com");
      expect(url.searchParams.get("type")).toBe("MX");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("accept")).toBe("application/dns-json");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return dnsResponse(0, [
        { type: 15, data: "10 mx1.example.com." },
        { type: 15, data: "20 mx2.example.com." },
      ]);
    });

    await expect(new EmailDomainValidator(fetcher).validate("USER@EXAMPLE.COM")).resolves.toEqual({
      ok: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the default Worker fetch as a validator method", async () => {
    const fetcher = vi.fn(async () => dnsResponse(0, [{ type: 15, data: "10 mx.example.com." }]));
    vi.stubGlobal("fetch", fetcher);

    try {
      await expect(new EmailDomainValidator().validate("user@example.com")).resolves.toEqual({
        ok: true,
      });
      expect(fetcher.mock.contexts).toEqual([undefined]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["Null MX", [{ type: 15, data: "0 ." }]],
    [
      "mixed Null and ordinary MX",
      [
        { type: 15, data: "0 ." },
        { type: 15, data: "10 mx.example.com." },
      ],
    ],
  ])("rejects %s records", async (_name, answers) => {
    const fetcher = vi.fn(async () => dnsResponse(0, answers));

    await expect(new EmailDomainValidator(fetcher).validate("user@example.com")).resolves.toEqual({
      ok: false,
      error: "invalid_domain",
    });
  });

  it("treats malformed MX data as an inconclusive lookup", async () => {
    const fetcher = vi.fn(async () => dnsResponse(0, [{ type: 15, data: "not-an-mx" }]));

    await expect(new EmailDomainValidator(fetcher).validate("user@example.com")).resolves.toEqual({
      ok: false,
      error: "lookup_failed",
    });
  });

  it("rejects an NXDOMAIN response", async () => {
    const fetcher = vi.fn(async () => dnsResponse(3));

    await expect(
      new EmailDomainValidator(fetcher).validate("user@missing.example"),
    ).resolves.toEqual({ ok: false, error: "invalid_domain" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["A", "192.0.2.10"],
    ["AAAA", "2001:db8::10"],
  ])("accepts an implicit MX backed by a valid %s record", async (addressType, address) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const type = queryType(input);
      if (type === "MX") {
        return dnsResponse();
      }
      if (type === addressType) {
        return dnsResponse(0, [{ type: addressType === "A" ? 1 : 28, data: address }]);
      }
      return dnsResponse();
    });

    await expect(new EmailDomainValidator(fetcher).validate("user@example.com")).resolves.toEqual({
      ok: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects a domain with no MX, A, or AAAA records", async () => {
    const fetcher = vi.fn(async () => dnsResponse());

    await expect(new EmailDomainValidator(fetcher).validate("user@example.com")).resolves.toEqual({
      ok: false,
      error: "invalid_domain",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("accepts a positive address result even when the other address lookup is temporary", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      switch (queryType(input)) {
        case "MX":
          return dnsResponse();
        case "A":
          return dnsResponse(0, [{ type: 1, data: "192.0.2.10" }]);
        case "AAAA":
          return dnsResponse(2);
        default:
          throw new Error("unexpected DNS record type");
      }
    });

    await expect(new EmailDomainValidator(fetcher).validate("user@example.com")).resolves.toEqual({
      ok: true,
    });
  });

  it("treats an inconclusive address fallback as a lookup failure", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      return queryType(input) === "A" ? dnsResponse(2) : dnsResponse();
    });

    await expect(new EmailDomainValidator(fetcher).validate("user@example.com")).resolves.toEqual({
      ok: false,
      error: "lookup_failed",
    });
  });

  it("treats malformed address data as a lookup failure", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (queryType(input) === "A") {
        return dnsResponse(0, [{ type: 1, data: "not-an-ip" }]);
      }
      return dnsResponse();
    });

    await expect(new EmailDomainValidator(fetcher).validate("user@example.com")).resolves.toEqual({
      ok: false,
      error: "lookup_failed",
    });
  });

  it.each([
    ["a fetch timeout", async () => Promise.reject(new DOMException("Timed out", "TimeoutError"))],
    ["a non-success HTTP response", async () => new Response(null, { status: 504 })],
    ["invalid JSON", async () => new Response("{")],
    ["an invalid response schema", async () => Response.json({ Status: "0", TC: false })],
    ["a truncated response", async () => dnsResponse(0, undefined, true)],
    ["SERVFAIL", async () => dnsResponse(2)],
  ])("treats %s as a lookup failure", async (_name, implementation) => {
    const fetcher = vi.fn(implementation);

    await expect(new EmailDomainValidator(fetcher).validate("user@example.com")).resolves.toEqual({
      ok: false,
      error: "lookup_failed",
    });
  });
});
