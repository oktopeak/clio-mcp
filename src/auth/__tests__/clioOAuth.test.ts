import { vi, describe, it, expect, afterEach } from "vitest";
import {
  generateCodeVerifier,
  deriveCodeChallenge,
  buildClioAuthorizeUrl,
  exchangeClioCode,
  refreshClioTokens,
  fetchClioWhoAmI,
  ClioOAuthError,
} from "../clioOAuth.js";

const CLIENT = { clientId: "cid", clientSecret: "csecret" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("PKCE helpers", () => {
  it("derives the RFC 7636 appendix B challenge", () => {
    expect(deriveCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generates base64url verifiers of at least 43 characters, all distinct", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(a).not.toBe(b);
  });
});

describe("buildClioAuthorizeUrl", () => {
  it.each([
    ["us", "https://app.clio.com"],
    ["eu", "https://eu.app.clio.com"],
    ["au", "https://au.app.clio.com"],
    ["ca", "https://ca.app.clio.com"],
  ] as const)("uses the %s region without reading CLIO_REGION", (region, origin) => {
    vi.stubEnv("CLIO_REGION", "eu"); // must be ignored when a region is passed
    const url = new URL(buildClioAuthorizeUrl({
      clientId: "cid", redirectUri: "https://x/cb", state: "st", region, codeChallenge: "chal",
    }));
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://x/cb");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("omits PKCE parameters when no challenge is given", () => {
    const url = new URL(buildClioAuthorizeUrl({ clientId: "c", redirectUri: "https://x", state: "s", region: "us" }));
    expect(url.searchParams.has("code_challenge")).toBe(false);
  });

  it("honours an explicit authorizeUrl over the region", () => {
    const url = buildClioAuthorizeUrl({
      clientId: "c", redirectUri: "https://x", state: "s", region: "us", authorizeUrl: "https://stub.test/oauth/authorize",
    });
    expect(url.startsWith("https://stub.test/oauth/authorize?")).toBe(true);
  });
});

describe("exchangeClioCode", () => {
  it("posts a form-encoded body with the code verifier to the regional token endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ access_token: "a1", refresh_token: "r1", expires_in: 3600 })
    );
    const before = Date.now();
    const tokens = await exchangeClioCode({ ...CLIENT, region: "ca", redirectUri: "https://x/cb", code: "the-code", codeVerifier: "ver" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://ca.app.clio.com/oauth/token");
    expect((init as RequestInit).headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("csecret");
    expect(body.get("redirect_uri")).toBe("https://x/cb");
    expect(body.get("code_verifier")).toBe("ver");
    expect(tokens.access_token).toBe("a1");
    expect(tokens.refresh_token).toBe("r1");
    expect(tokens.expires_at).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  it("throws ClioOAuthError with the OAuth error code on a non-2xx answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400));
    const err = await exchangeClioCode({ ...CLIENT, region: "us", redirectUri: "https://x", code: "bad" }).catch((e) => e);
    expect(err).toBeInstanceOf(ClioOAuthError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("invalid_grant");
  });
});

describe("refreshClioTokens", () => {
  it("keeps the previous refresh token when Clio does not send a new one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ access_token: "a2", expires_in: 100 }));
    const tokens = await refreshClioTokens({ ...CLIENT, region: "us", refreshToken: "old-refresh" });
    expect(tokens.access_token).toBe("a2");
    expect(tokens.refresh_token).toBe("old-refresh");
  });

  it("stores a rotated refresh token when Clio sends one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ access_token: "a2", refresh_token: "new-refresh", expires_in: 100 }));
    const tokens = await refreshClioTokens({ ...CLIENT, region: "us", refreshToken: "old-refresh" });
    expect(tokens.refresh_token).toBe("new-refresh");
  });

  it("uses an explicit tokenUrl when given", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ access_token: "a", expires_in: 1 }));
    await refreshClioTokens({ ...CLIENT, tokenUrl: "https://stub.test/oauth/token", refreshToken: "r" });
    expect(fetchSpy.mock.calls[0][0]).toBe("https://stub.test/oauth/token");
  });
});

describe("fetchClioWhoAmI", () => {
  it("requests the default fields and parses the user", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: { id: 42, name: "Jane Doe", email: "jane@firm.test" } })
    );
    const me = await fetchClioWhoAmI("tok", { region: "eu" });
    const url = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://eu.app.clio.com/api/v4/users/who_am_i.json");
    expect(url.searchParams.get("fields")).toBe("id,name,email");
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: "Bearer tok" });
    expect(me).toEqual({ id: "42", name: "Jane Doe", email: "jane@firm.test" });
  });

  it("includes the account when Clio returns it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: { id: 1, account: { id: 777, name: "Doe Law" } } })
    );
    const me = await fetchClioWhoAmI("tok", { region: "us", fields: "id,account{id,name}" });
    expect(me.accountId).toBe("777");
    expect(me.accountName).toBe("Doe Law");
  });

  it("throws ClioOAuthError on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("forbidden", { status: 403 }));
    await expect(fetchClioWhoAmI("tok", { region: "us" })).rejects.toBeInstanceOf(ClioOAuthError);
  });
});
