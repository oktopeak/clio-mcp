import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import net from "node:net";
import http from "node:http";

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
  runOAuthFlow,
  buildAuthorizationUrl,
  exchangeCodeForTokensPure,
  refreshTokensPure,
  getValidAccessToken,
} from "../oauth.js";

// This suite locks in the CURRENT, unmodified behavior of oauth.ts before any
// broker-mode code is added. It must keep passing byte-for-byte throughout
// that work — that's the proof BYO mode was not altered.

const ENV_KEYS = [
  "CLIO_CLIENT_ID",
  "CLIO_CLIENT_SECRET",
  "CLIO_REDIRECT_PORT",
  "CLIO_AUTH_URL",
  "CLIO_TOKEN_URL",
  "CLIO_API_BASE",
  "CLIO_REGION",
  "MCP_BASE_URL",
] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const DEFAULT_ENV: Record<EnvKey, string> = {
  CLIO_CLIENT_ID: "test-client-id",
  CLIO_CLIENT_SECRET: "test-client-secret",
  CLIO_REDIRECT_PORT: "5678",
  CLIO_AUTH_URL: "https://fake-clio.test/oauth/authorize",
  CLIO_TOKEN_URL: "https://fake-clio.test/oauth/token",
  CLIO_API_BASE: "https://fake-clio.test/api/v4",
  CLIO_REGION: "us",
  MCP_BASE_URL: "http://127.0.0.1:3000",
};

function applyEnv(overrides: Partial<Record<EnvKey, string>> = {}) {
  const merged = { ...DEFAULT_ENV, ...overrides };
  for (const key of ENV_KEYS) {
    process.env[key] = merged[key];
  }
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

function waitForPortOpen(port: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`port ${port} did not open in time`));
        else setTimeout(attempt, 20);
      });
    };
    attempt();
  });
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  applyEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exchangeCodeForTokensPure", () => {
  it("posts grant_type=authorization_code with client credentials and computes expires_at", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: "AT1", refresh_token: "RT1", expires_in: 3600 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const before = Date.now();
    const tokens = await exchangeCodeForTokensPure("auth-code-1", "http://127.0.0.1:5678/callback");
    const after = Date.now();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://fake-clio.test/oauth/token");
    expect(options.method).toBe("POST");
    const body = options.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code-1");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
    expect(body.get("redirect_uri")).toBe("http://127.0.0.1:5678/callback");

    expect(tokens.access_token).toBe("AT1");
    expect(tokens.refresh_token).toBe("RT1");
    expect(tokens.expires_at).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(tokens.expires_at).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  it("throws a descriptive error on failure, without ever including the client secret", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: async () => '{"error":"invalid_client"}' });
    vi.stubGlobal("fetch", fetchMock);

    let caught: Error | undefined;
    try {
      await exchangeCodeForTokensPure("bad-code", "http://127.0.0.1:5678/callback");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toMatch(/Token exchange failed/);
    expect(caught?.message).not.toContain("test-client-secret");
  });
});

describe("refreshTokensPure", () => {
  it("posts grant_type=refresh_token with client credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { access_token: "AT2", refresh_token: "RT2", expires_in: 1800 }));
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await refreshTokensPure("old-refresh-token");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://fake-clio.test/oauth/token");
    const body = options.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh-token");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
    expect(tokens.access_token).toBe("AT2");
    expect(tokens.refresh_token).toBe("RT2");
  });

  it("falls back to the old refresh_token when Clio's response omits one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: "AT3", expires_in: 1800 }));
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await refreshTokensPure("keep-me");
    expect(tokens.refresh_token).toBe("keep-me");
  });

  it("throws a generic re-authenticate message on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshTokensPure("x")).rejects.toThrow("Token refresh failed, please re-authenticate.");
  });
});

describe("buildAuthorizationUrl", () => {
  it("builds a Clio authorize URL and encodes state as base64url(sessionId:nonce)", () => {
    const { url, nonce } = buildAuthorizationUrl("session-123");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://fake-clio.test/oauth/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3000/oauth/callback");

    const state = parsed.searchParams.get("state")!;
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    expect(decoded).toBe(`session-123:${nonce}`);
  });

  it("generates a fresh nonce/state on each call", () => {
    const first = buildAuthorizationUrl("session-abc");
    const second = buildAuthorizationUrl("session-abc");
    expect(first.nonce).not.toBe(second.nonce);
  });
});

describe("runOAuthFlow (local callback server, end-to-end)", () => {
  it("opens the browser, waits for the callback, exchanges the code, resolves who_am_i, and saves tokens", async () => {
    const TEST_PORT = "58234";
    applyEnv({ CLIO_REDIRECT_PORT: TEST_PORT });
    let capturedAuthUrl = "";
    mockOpen.mockImplementation(async (url: string) => {
      capturedAuthUrl = url;
    });

    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/oauth/token")) {
        return jsonResponse(200, { access_token: "AT-flow", refresh_token: "RT-flow", expires_in: 3600 });
      }
      if (u.includes("who_am_i")) {
        return jsonResponse(200, { data: { id: 999 } });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const flowPromise = runOAuthFlow();

    await vi.waitFor(
      () => {
        if (!capturedAuthUrl) throw new Error("authorize URL not captured yet");
      },
      { timeout: 2000, interval: 10 }
    );
    await waitForPortOpen(Number(TEST_PORT));

    const state = new URL(capturedAuthUrl).searchParams.get("state")!;
    const callbackRes = await httpGet(
      `http://127.0.0.1:${TEST_PORT}/callback?code=auth-code-xyz&state=${state}`
    );
    expect(callbackRes.status).toBe(200);
    expect(callbackRes.body).toContain("Authentication successful");

    const tokens = await flowPromise;
    expect(tokens.access_token).toBe("AT-flow");
    expect(tokens.clio_user_id).toBe("999");
    expect(mockSaveTokens).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "AT-flow", clio_user_id: "999" })
    );
  });

  it("rejects with a state-mismatch error when the callback state does not match", async () => {
    const TEST_PORT = "58236";
    applyEnv({ CLIO_REDIRECT_PORT: TEST_PORT });
    let capturedAuthUrl = "";
    mockOpen.mockImplementation(async (url: string) => {
      capturedAuthUrl = url;
    });
    vi.stubGlobal("fetch", vi.fn());

    const flowPromise = runOAuthFlow();
    flowPromise.catch(() => {}); // avoid unhandled rejection before the assertion below

    await vi.waitFor(
      () => {
        if (!capturedAuthUrl) throw new Error("authorize URL not captured yet");
      },
      { timeout: 2000, interval: 10 }
    );
    await waitForPortOpen(Number(TEST_PORT));

    await httpGet(`http://127.0.0.1:${TEST_PORT}/callback?code=whatever&state=forged-state`);
    await expect(flowPromise).rejects.toThrow("State mismatch");
  });
});

describe("getValidAccessToken", () => {
  const TEST_PORT = "58235";

  beforeEach(() => {
    applyEnv({ CLIO_REDIRECT_PORT: TEST_PORT });
  });

  it("runs the full OAuth flow when no tokens are stored", async () => {
    mockLoadTokens.mockResolvedValue(null);

    let capturedAuthUrl = "";
    mockOpen.mockImplementation(async (url: string) => {
      capturedAuthUrl = url;
    });

    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/oauth/token")) {
        return jsonResponse(200, { access_token: "AT-new", refresh_token: "RT-new", expires_in: 3600 });
      }
      if (u.includes("who_am_i")) {
        return jsonResponse(200, { data: { id: 42 } });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tokenPromise = getValidAccessToken();

    await vi.waitFor(
      () => {
        if (!capturedAuthUrl) throw new Error("authorize URL not captured yet");
      },
      { timeout: 2000, interval: 10 }
    );
    await waitForPortOpen(Number(TEST_PORT));

    const state = new URL(capturedAuthUrl).searchParams.get("state")!;
    await httpGet(`http://127.0.0.1:${TEST_PORT}/callback?code=new-code&state=${state}`);

    const accessToken = await tokenPromise;
    expect(accessToken).toBe("AT-new");
  });

  it("refreshes when the stored token is within 5 minutes of expiry", async () => {
    mockLoadTokens.mockResolvedValue({
      access_token: "AT-old",
      refresh_token: "RT-old",
      expires_at: Date.now() + 60 * 1000, // 1 minute left — inside the 5-minute refresh window
      clio_user_id: "10023",
    });

    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/oauth/token")) {
        return jsonResponse(200, { access_token: "AT-refreshed", refresh_token: "RT-refreshed", expires_in: 3600 });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const accessToken = await getValidAccessToken();
    expect(accessToken).toBe("AT-refreshed");
    expect(mockSaveTokens).toHaveBeenCalledWith(expect.objectContaining({ access_token: "AT-refreshed" }));
  });

  it("resolves a missing clio_user_id via who_am_i and persists it", async () => {
    mockLoadTokens.mockResolvedValue({
      access_token: "AT-ok",
      refresh_token: "RT-ok",
      expires_at: Date.now() + 60 * 60 * 1000,
    });

    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("who_am_i")) {
        return jsonResponse(200, { data: { id: 555 } });
      }
      throw new Error(`Unexpected fetch to ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const accessToken = await getValidAccessToken();
    expect(accessToken).toBe("AT-ok");
    expect(mockSaveTokens).toHaveBeenCalledWith(expect.objectContaining({ clio_user_id: "555" }));
  });

  it("does not retry who_am_i once user_id_unavailable is set", async () => {
    mockLoadTokens.mockResolvedValue({
      access_token: "AT-ok",
      refresh_token: "RT-ok",
      expires_at: Date.now() + 60 * 60 * 1000,
      user_id_unavailable: true,
    });

    const fetchMock = vi.fn(async (url: unknown) => {
      throw new Error(`Unexpected fetch to ${String(url)} — who_am_i should not be retried`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const accessToken = await getValidAccessToken();
    expect(accessToken).toBe("AT-ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
