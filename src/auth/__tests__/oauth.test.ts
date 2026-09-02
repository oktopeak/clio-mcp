import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// oauth.ts pulls in tokenStorage (OS keychain); stub it so no native module loads.
vi.mock("../tokenStorage.js", () => ({
  saveTokens: vi.fn().mockResolvedValue(undefined),
  loadTokens: vi.fn().mockResolvedValue(null),
}));

import { buildAuthorizationUrl, refreshTokensPure, exchangeCodeForTokensPure } from "../oauth.js";

const REGIONS: Array<[string, string]> = [
  ["us", "https://app.clio.com"],
  ["eu", "https://eu.app.clio.com"],
  ["au", "https://au.app.clio.com"],
  ["ca", "https://ca.app.clio.com"],
];

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

beforeEach(() => {
  vi.stubEnv("CLIO_CLIENT_ID", "client-123");
  vi.stubEnv("CLIO_CLIENT_SECRET", "secret-456");
  vi.stubEnv("MCP_BASE_URL", "https://mcp.example.com");
  vi.stubEnv("CLIO_REGION", undefined);
  vi.stubEnv("CLIO_AUTH_URL", undefined);
  vi.stubEnv("CLIO_TOKEN_URL", undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buildAuthorizationUrl", () => {
  it.each(REGIONS)("uses the %s OAuth authorize endpoint on %s", (region, host) => {
    vi.stubEnv("CLIO_REGION", region);
    const { url, nonce } = buildAuthorizationUrl("sess-1");
    const parsed = new URL(url);
    expect(parsed.origin).toBe(host);
    expect(parsed.pathname).toBe("/oauth/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("client-123");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://mcp.example.com/oauth/callback");
    const state = Buffer.from(parsed.searchParams.get("state")!, "base64url").toString("utf8");
    expect(state).toBe(`sess-1:${nonce}`);
  });

  it("defaults to the US endpoint when CLIO_REGION is unset", () => {
    expect(new URL(buildAuthorizationUrl("s").url).origin).toBe("https://app.clio.com");
  });

  it("throws for an unknown region instead of silently using the US endpoint", () => {
    vi.stubEnv("CLIO_REGION", "uk");
    expect(() => buildAuthorizationUrl("sess-1")).toThrow(/Invalid CLIO_REGION "uk"/);
  });

  it("honours a CLIO_AUTH_URL override", () => {
    vi.stubEnv("CLIO_REGION", "au");
    vi.stubEnv("CLIO_AUTH_URL", "https://proxy.example.com/oauth/authorize");
    expect(new URL(buildAuthorizationUrl("s").url).origin).toBe("https://proxy.example.com");
  });
});

describe("token endpoint per region", () => {
  it.each(REGIONS)("refreshTokensPure posts to the %s token endpoint", async (region, host) => {
    vi.stubEnv("CLIO_REGION", region);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenResponse());
    const tokens = await refreshTokensPure("old-refresh");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${host}/oauth/token`);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(tokens.access_token).toBe("access-1");
  });

  it.each(REGIONS)("exchangeCodeForTokensPure posts to the %s token endpoint", async (region, host) => {
    vi.stubEnv("CLIO_REGION", region);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenResponse());
    await exchangeCodeForTokensPure("code-1", "https://mcp.example.com/oauth/callback");
    expect(fetchMock.mock.calls[0][0]).toBe(`${host}/oauth/token`);
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain("grant_type=authorization_code");
  });

  it("honours a CLIO_TOKEN_URL override", async () => {
    vi.stubEnv("CLIO_REGION", "ca");
    vi.stubEnv("CLIO_TOKEN_URL", "https://proxy.example.com/oauth/token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenResponse());
    await refreshTokensPure("old-refresh");
    expect(fetchMock.mock.calls[0][0]).toBe("https://proxy.example.com/oauth/token");
  });

  it("rejects an unknown region before any network call", async () => {
    vi.stubEnv("CLIO_REGION", "usa");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(tokenResponse());
    await expect(refreshTokensPure("old-refresh")).rejects.toThrow(/Invalid CLIO_REGION "usa"/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
