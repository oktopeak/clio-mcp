import { vi, describe, it, expect, beforeEach } from "vitest";

const {
  mockIsBrokerMode,
  mockGetBrokerUrl,
  mockPollBrokerOnce,
  mockRefreshTokensViaBroker,
  mockRefreshTokensPure,
  mockFetchClioWhoAmI,
  mockAppendAuditLog,
} = vi.hoisted(() => ({
  mockIsBrokerMode: vi.fn(),
  mockGetBrokerUrl: vi.fn().mockReturnValue("https://broker.test"),
  mockPollBrokerOnce: vi.fn(),
  mockRefreshTokensViaBroker: vi.fn(),
  mockRefreshTokensPure: vi.fn(),
  mockFetchClioWhoAmI: vi.fn().mockResolvedValue({ id: "u-broker" }),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../auth/oauth.js", () => ({
  buildAuthorizationUrl: vi.fn(),
  exchangeCodeForTokensPure: vi.fn(),
  refreshTokensPure: mockRefreshTokensPure,
  isBrokerMode: mockIsBrokerMode,
  getBrokerUrl: mockGetBrokerUrl,
  pollBrokerOnce: mockPollBrokerOnce,
  refreshTokensViaBroker: mockRefreshTokensViaBroker,
}));

vi.mock("../../auth/clioOAuth.js", () => ({
  fetchClioWhoAmI: mockFetchClioWhoAmI,
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

// http.ts registers MCP tools and builds an Express app at import time —
// none of that touches network/env, so importing it directly for its
// exported buildSessionContext/SessionRecord is safe and avoids needing a
// running server or supertest.
import { buildSessionContext, SessionRecord } from "../http.js";

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    transport: null as any,
    mcpServer: null,
    tokens: null,
    pendingOAuthNonce: null,
    pendingBroker: null,
    refreshInFlight: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBrokerUrl.mockReturnValue("https://broker.test");
});

describe("getAccessToken — broker mode, no tokens yet", () => {
  it("throws the generic 'not authenticated' error when there's no pending broker session", async () => {
    mockIsBrokerMode.mockReturnValue(true);
    const record = makeRecord();
    const ctx = buildSessionContext(record, "sess-1");

    await expect(ctx.getAccessToken()).rejects.toThrow(/Not authenticated/);
    expect(mockPollBrokerOnce).not.toHaveBeenCalled();
  });

  it("polls once and throws a 'still in progress' error while the broker reports pending", async () => {
    mockIsBrokerMode.mockReturnValue(true);
    mockPollBrokerOnce.mockResolvedValue({ status: "pending" });
    const record = makeRecord({ pendingBroker: { brokerSessionId: "bsid-1", codeVerifier: "verifier-1" } });
    const ctx = buildSessionContext(record, "sess-1");

    await expect(ctx.getAccessToken()).rejects.toThrow(/still in progress/);
    expect(mockPollBrokerOnce).toHaveBeenCalledTimes(1);
    expect(mockPollBrokerOnce).toHaveBeenCalledWith("https://broker.test", "bsid-1", "verifier-1");
    // Session stays pending — a legitimate retry should be able to poll again.
    expect(record.pendingBroker).toEqual({ brokerSessionId: "bsid-1", codeVerifier: "verifier-1" });
  });

  it("stores tokens, clears pendingBroker, resolves the user id, and audit-logs on ready", async () => {
    mockIsBrokerMode.mockReturnValue(true);
    mockPollBrokerOnce.mockResolvedValue({
      status: "ready",
      tokens: { access_token: "AT-ready", refresh_token: "RT-ready", expires_at: Date.now() + 3600_000 },
    });
    const record = makeRecord({ pendingBroker: { brokerSessionId: "bsid-2", codeVerifier: "verifier-2" } });
    const ctx = buildSessionContext(record, "sess-2");

    const token = await ctx.getAccessToken();

    expect(token).toBe("AT-ready");
    expect(record.pendingBroker).toBeNull();
    expect(mockFetchClioWhoAmI).toHaveBeenCalledWith("AT-ready");
    expect(record.tokens!.clio_user_id).toBe("u-broker");
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "oauth_callback", outcome: "success" })
    );
  });

  it("clears pendingBroker (fail closed) when the poll itself throws — e.g. a forged/expired broker session", async () => {
    mockIsBrokerMode.mockReturnValue(true);
    mockPollBrokerOnce.mockRejectedValue(new Error("Broker login failed (HTTP 404). Please try again."));
    const record = makeRecord({ pendingBroker: { brokerSessionId: "bsid-3", codeVerifier: "verifier-3" } });
    const ctx = buildSessionContext(record, "sess-3");

    await expect(ctx.getAccessToken()).rejects.toThrow(/Broker login failed/);
    expect(record.pendingBroker).toBeNull();
  });
});

describe("getAccessToken — refresh dispatch", () => {
  it("uses refreshTokensViaBroker (never refreshTokensPure) when isBrokerMode() is true", async () => {
    mockIsBrokerMode.mockReturnValue(true);
    mockRefreshTokensViaBroker.mockResolvedValue({
      access_token: "AT-refreshed",
      refresh_token: "RT-refreshed",
      expires_at: Date.now() + 3600_000,
    });
    const record = makeRecord({
      tokens: {
        access_token: "AT-old",
        refresh_token: "RT-old",
        expires_at: Date.now() + 60_000, // within the 5-minute refresh window
        clio_user_id: "u-1",
      },
    });
    const ctx = buildSessionContext(record, "sess-4");

    const token = await ctx.getAccessToken();

    expect(token).toBe("AT-refreshed");
    expect(mockRefreshTokensViaBroker).toHaveBeenCalledWith("RT-old");
    expect(mockRefreshTokensPure).not.toHaveBeenCalled();
    expect(record.tokens?.clio_user_id).toBe("u-1"); // carried over from the prior token record
  });

  it("uses refreshTokensPure (never refreshTokensViaBroker) when isBrokerMode() is false — BYOC unchanged", async () => {
    mockIsBrokerMode.mockReturnValue(false);
    mockRefreshTokensPure.mockResolvedValue({
      access_token: "AT-byoc-refreshed",
      refresh_token: "RT-byoc-refreshed",
      expires_at: Date.now() + 3600_000,
    });
    const record = makeRecord({
      tokens: {
        access_token: "AT-old",
        refresh_token: "RT-old",
        expires_at: Date.now() + 60_000,
        clio_user_id: "u-2",
      },
    });
    const ctx = buildSessionContext(record, "sess-5");

    const token = await ctx.getAccessToken();

    expect(token).toBe("AT-byoc-refreshed");
    expect(mockRefreshTokensPure).toHaveBeenCalledWith("RT-old");
    expect(mockRefreshTokensViaBroker).not.toHaveBeenCalled();
  });

  it("BYOC mode with no tokens still throws the plain 'not authenticated' error (no broker polling attempted)", async () => {
    mockIsBrokerMode.mockReturnValue(false);
    const record = makeRecord();
    const ctx = buildSessionContext(record, "sess-6");

    await expect(ctx.getAccessToken()).rejects.toThrow(/Not authenticated/);
    expect(mockPollBrokerOnce).not.toHaveBeenCalled();
  });
});
