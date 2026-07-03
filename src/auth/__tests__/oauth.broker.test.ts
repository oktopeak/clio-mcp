import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

const { mockSaveTokens, mockLoadTokens, mockOpen } = vi.hoisted(() => ({
  mockSaveTokens: vi.fn().mockResolvedValue(undefined),
  mockLoadTokens: vi.fn(),
  mockOpen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../tokenStorage.js", () => ({
  saveTokens: mockSaveTokens,
  loadTokens: mockLoadTokens,
}));

vi.mock("open", () => ({ default: mockOpen }));

import {
  generateCodeVerifier,
  deriveCodeChallenge,
  isBrokerMode,
  runBrokerOAuthFlow,
  refreshTokensViaBroker,
  getValidAccessToken,
  startBrokerLogin,
  pollBrokerOnce,
} from "../oauth.js";

const BROKER_URL = "https://broker.test";

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CLIO_CLIENT_ID;
  delete process.env.CLIO_CLIENT_SECRET;
  process.env.TOKEN_BROKER_URL = BROKER_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TOKEN_BROKER_URL;
});

describe("PKCE helpers", () => {
  it("generateCodeVerifier produces a high-entropy base64url string", () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
    expect(v1.length).toBeGreaterThanOrEqual(43);
    expect(v1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("deriveCodeChallenge matches the RFC 7636 Appendix B test vector", () => {
    // RFC 7636 Appendix B: verifier -> S256 challenge
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = deriveCodeChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("isBrokerMode", () => {
  it("is true when TOKEN_BROKER_URL is set", () => {
    process.env.TOKEN_BROKER_URL = BROKER_URL;
    expect(isBrokerMode()).toBe(true);
  });

  it("is false when TOKEN_BROKER_URL is unset or blank", () => {
    delete process.env.TOKEN_BROKER_URL;
    expect(isBrokerMode()).toBe(false);
    process.env.TOKEN_BROKER_URL = "   ";
    expect(isBrokerMode()).toBe(false);
  });
});

describe("runBrokerOAuthFlow", () => {
  it("starts a broker session, opens the authorize_url, polls until ready, and saves tokens", async () => {
    let capturedStartBody: any;
    let pollCount = 0;

    const fetchMock = vi.fn(async (url: unknown, init?: any) => {
      const u = String(url);
      if (u === `${BROKER_URL}/auth/start`) {
        capturedStartBody = JSON.parse(init.body);
        return jsonResponse(200, { session_id: "sess-1", authorize_url: "https://fake-clio.test/oauth/authorize?x=1" });
      }
      if (u === `${BROKER_URL}/auth/poll`) {
        pollCount++;
        if (pollCount === 1) return { status: 202, ok: false, json: async () => ({ status: "pending" }) };
        return jsonResponse(200, { access_token: "AT-b", refresh_token: "RT-b", expires_in: 3600 });
      }
      if (u.includes("who_am_i")) {
        return jsonResponse(200, { data: { id: 42 } });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("setTimeout", ((fn: () => void) => { fn(); return 0 as any; }) as any);

    let openedUrl = "";
    mockOpen.mockImplementation(async (url: string) => {
      openedUrl = url;
    });

    const tokens = await runBrokerOAuthFlow();

    expect(capturedStartBody.code_challenge).toBeTruthy();
    expect(openedUrl).toBe("https://fake-clio.test/oauth/authorize?x=1");
    expect(pollCount).toBe(2);
    expect(tokens.access_token).toBe("AT-b");
    expect(tokens.clio_user_id).toBe("42");
    expect(mockSaveTokens).toHaveBeenCalledWith(expect.objectContaining({ access_token: "AT-b" }));
  });

  it("never sends a client secret anywhere — the connector doesn't have one to send", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: any) => {
      const u = String(url);
      const bodyStr = init?.body ? String(init.body) : "";
      expect(bodyStr).not.toMatch(/client_secret/);
      if (u === `${BROKER_URL}/auth/start`) {
        return jsonResponse(200, { session_id: "sess-2", authorize_url: "https://fake-clio.test/oauth/authorize" });
      }
      if (u === `${BROKER_URL}/auth/poll`) {
        return jsonResponse(200, { access_token: "AT-c", refresh_token: "RT-c", expires_in: 3600 });
      }
      if (u.includes("who_am_i")) {
        return jsonResponse(200, { data: { id: 1 } });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    mockOpen.mockResolvedValue(undefined);

    await runBrokerOAuthFlow();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("times out if the broker never reports readiness", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === `${BROKER_URL}/auth/start`) {
        return jsonResponse(200, { session_id: "sess-3", authorize_url: "https://fake-clio.test/oauth/authorize" });
      }
      if (u === `${BROKER_URL}/auth/poll`) {
        return { status: 202, ok: false, json: async () => ({ status: "pending" }) };
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    mockOpen.mockResolvedValue(undefined);

    let now = 0;
    vi.stubGlobal("setTimeout", ((fn: () => void) => { now += 2000; fn(); return 0 as any; }) as any);
    const realDateNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realDateNow() + now);

    await expect(runBrokerOAuthFlow()).rejects.toThrow(/OAuth timeout/);
  });
});

describe("refreshTokensViaBroker", () => {
  it("posts refresh_token to the broker's /refresh endpoint with no client credentials", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: any) => {
      expect(String(url)).toBe(`${BROKER_URL}/refresh`);
      const body = JSON.parse(init.body);
      expect(body).toEqual({ refresh_token: "old-refresh" });
      return jsonResponse(200, { access_token: "AT-r", refresh_token: "RT-r", expires_in: 1800 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await refreshTokensViaBroker("old-refresh");
    expect(tokens.access_token).toBe("AT-r");
    expect(tokens.refresh_token).toBe("RT-r");
  });

  it("falls back to the old refresh token when the broker omits one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: "AT-r2", expires_in: 1800 }));
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await refreshTokensViaBroker("keep-me");
    expect(tokens.refresh_token).toBe("keep-me");
  });

  it("throws a generic re-authenticate message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    await expect(refreshTokensViaBroker("x")).rejects.toThrow("Token refresh failed, please re-authenticate.");
  });
});

describe("startBrokerLogin", () => {
  it("posts the code_challenge and returns session_id/authorize_url with no client_secret in the request", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: any) => {
      expect(String(url)).toBe(`${BROKER_URL}/auth/start`);
      const body = JSON.parse(init.body);
      expect(body).toEqual({ code_challenge: "chal-1" });
      expect(String(init.body)).not.toMatch(/client_secret/);
      return jsonResponse(200, { session_id: "sess-http-1", authorize_url: "https://fake-clio.test/oauth/authorize?x=1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { sessionId, authorizeUrl } = await startBrokerLogin("chal-1");
    expect(sessionId).toBe("sess-http-1");
    expect(authorizeUrl).toBe("https://fake-clio.test/oauth/authorize?x=1");
  });

  it("throws when the broker rejects the start request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    await expect(startBrokerLogin("bad-challenge")).rejects.toThrow(/Failed to start broker login/);
  });
});

describe("pollBrokerOnce", () => {
  it("returns status 'pending' on HTTP 202 without sleeping or looping", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 202, ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pollBrokerOnce(BROKER_URL, "sess-1", "verifier-1");
    expect(result).toEqual({ status: "pending" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns status 'ready' with tokens on HTTP 200", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: any) => {
      expect(String(url)).toBe(`${BROKER_URL}/auth/poll`);
      expect(JSON.parse(init.body)).toEqual({ session_id: "sess-1", code_verifier: "verifier-1" });
      return jsonResponse(200, { access_token: "AT-once", refresh_token: "RT-once", expires_in: 3600 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pollBrokerOnce(BROKER_URL, "sess-1", "verifier-1");
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.tokens.access_token).toBe("AT-once");
    }
  });

  it("throws on a non-2xx, non-202 response (e.g. forged/expired session)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    await expect(pollBrokerOnce(BROKER_URL, "sess-x", "verifier-x")).rejects.toThrow(/Broker login failed/);
  });
});

describe("getValidAccessToken dispatch in broker mode", () => {
  it("calls the broker flow (not the local-callback flow) when no tokens are stored", async () => {
    mockLoadTokens.mockResolvedValue(null);

    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === `${BROKER_URL}/auth/start`) {
        return jsonResponse(200, { session_id: "sess-4", authorize_url: "https://fake-clio.test/oauth/authorize" });
      }
      if (u === `${BROKER_URL}/auth/poll`) {
        return jsonResponse(200, { access_token: "AT-d", refresh_token: "RT-d", expires_in: 3600 });
      }
      if (u.includes("who_am_i")) {
        return jsonResponse(200, { data: { id: 7 } });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    mockOpen.mockResolvedValue(undefined);

    const accessToken = await getValidAccessToken();
    expect(accessToken).toBe("AT-d");
    // No local http.createServer callback listener should have been needed —
    // proven implicitly by never binding a port; if the dispatch had wrongly
    // picked runOAuthFlow, this test would hang waiting for a local callback
    // that never arrives and time out instead of resolving.
  });

  it("refreshes via the broker (no client credentials) when the stored token is expiring", async () => {
    mockLoadTokens.mockResolvedValue({
      access_token: "AT-old",
      refresh_token: "RT-old",
      expires_at: Date.now() + 60 * 1000,
      clio_user_id: "10023",
    });

    const fetchMock = vi.fn(async (url: unknown, init?: any) => {
      expect(String(url)).toBe(`${BROKER_URL}/refresh`);
      expect(String(init.body)).not.toMatch(/client_secret/);
      return jsonResponse(200, { access_token: "AT-refreshed-broker", refresh_token: "RT-refreshed-broker", expires_in: 3600 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const accessToken = await getValidAccessToken();
    expect(accessToken).toBe("AT-refreshed-broker");
    expect(mockSaveTokens).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "AT-refreshed-broker", clio_user_id: "10023" })
    );
  });
});
