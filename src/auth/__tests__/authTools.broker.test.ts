import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const {
  mockGetSessionContext,
  mockAppendAuditLog,
  mockIsBrokerMode,
  mockStartBrokerLogin,
  mockBuildAuthorizationUrl,
  mockGetValidAccessToken,
  mockGenerateCodeVerifier,
  mockDeriveCodeChallenge,
  mockLoadTokens,
  mockClearTokens,
} = vi.hoisted(() => ({
  mockGetSessionContext: vi.fn(),
  mockAppendAuditLog: vi.fn().mockResolvedValue(undefined),
  mockIsBrokerMode: vi.fn(),
  mockStartBrokerLogin: vi.fn(),
  mockBuildAuthorizationUrl: vi.fn(),
  mockGetValidAccessToken: vi.fn(),
  mockGenerateCodeVerifier: vi.fn().mockReturnValue("verifier-xyz"),
  mockDeriveCodeChallenge: vi.fn().mockReturnValue("challenge-xyz"),
  mockLoadTokens: vi.fn(),
  mockClearTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/sessionContext.js", () => ({
  requireSessionContext: mockGetSessionContext,
}));

vi.mock("../../utils/auditLog.js", () => ({
  appendAuditLog: mockAppendAuditLog,
}));

vi.mock("../tokenStorage.js", () => ({
  loadTokens: mockLoadTokens,
  clearTokens: mockClearTokens,
}));

vi.mock("../oauth.js", () => ({
  getValidAccessToken: mockGetValidAccessToken,
  buildAuthorizationUrl: mockBuildAuthorizationUrl,
  isBrokerMode: mockIsBrokerMode,
  generateCodeVerifier: mockGenerateCodeVerifier,
  deriveCodeChallenge: mockDeriveCodeChallenge,
  startBrokerLogin: mockStartBrokerLogin,
}));

import { registerAuthTools } from "../authTools.js";

const handlers = new Map<string, () => Promise<any>>();

beforeAll(() => {
  const fakeServer = {
    registerTool: (name: string, _schema: unknown, handler: () => Promise<any>) => {
      handlers.set(name, handler);
    },
  };
  registerAuthTools(fakeServer as any);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateCodeVerifier.mockReturnValue("verifier-xyz");
  mockDeriveCodeChallenge.mockReturnValue("challenge-xyz");
});

describe("authenticate — HTTP mode, broker on", () => {
  it("starts a broker login, stores the pending session on ctx, and returns the broker's authorize_url", async () => {
    const setPendingBrokerSession = vi.fn();
    const setPendingNonce = vi.fn();
    mockGetSessionContext.mockReturnValue({
      sessionId: "http-sess-1",
      setPendingBrokerSession,
      setPendingNonce,
    });
    mockIsBrokerMode.mockReturnValue(true);
    mockStartBrokerLogin.mockResolvedValue({
      sessionId: "broker-sess-1",
      authorizeUrl: "https://fake-clio.test/oauth/authorize?x=1",
    });

    const handler = handlers.get("authenticate")!;
    const result = await handler();

    expect(mockDeriveCodeChallenge).toHaveBeenCalledWith("verifier-xyz");
    expect(mockStartBrokerLogin).toHaveBeenCalledWith("challenge-xyz");
    expect(setPendingBrokerSession).toHaveBeenCalledWith({
      brokerSessionId: "broker-sess-1",
      codeVerifier: "verifier-xyz",
    });
    expect(setPendingNonce).not.toHaveBeenCalled();
    expect(mockBuildAuthorizationUrl).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("https://fake-clio.test/oauth/authorize?x=1");
  });

  it("falls back to the BYOC authorize-URL flow when broker mode is off", async () => {
    const setPendingBrokerSession = vi.fn();
    const setPendingNonce = vi.fn();
    mockGetSessionContext.mockReturnValue({
      sessionId: "http-sess-2",
      setPendingBrokerSession,
      setPendingNonce,
    });
    mockIsBrokerMode.mockReturnValue(false);
    mockBuildAuthorizationUrl.mockReturnValue({ url: "https://app.clio.com/oauth/authorize?y=1", nonce: "nonce-1" });

    const handler = handlers.get("authenticate")!;
    const result = await handler();

    expect(mockStartBrokerLogin).not.toHaveBeenCalled();
    expect(setPendingNonce).toHaveBeenCalledWith("nonce-1");
    expect(setPendingBrokerSession).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("https://app.clio.com/oauth/authorize?y=1");
  });

  it("reports isError without touching ctx state when the broker rejects the start request", async () => {
    const setPendingBrokerSession = vi.fn();
    mockGetSessionContext.mockReturnValue({
      sessionId: "http-sess-3",
      setPendingBrokerSession,
      setPendingNonce: vi.fn(),
    });
    mockIsBrokerMode.mockReturnValue(true);
    mockStartBrokerLogin.mockRejectedValue(new Error("Failed to start broker login (HTTP 429)."));

    const handler = handlers.get("authenticate")!;
    const result = await handler();

    expect(result.isError).toBe(true);
    expect(setPendingBrokerSession).not.toHaveBeenCalled();
  });
});

describe("authenticate — stdio mode (no ctx) is unaffected by broker wiring", () => {
  it("still calls getValidAccessToken directly, regardless of isBrokerMode", async () => {
    mockGetSessionContext.mockReturnValue(undefined);
    mockIsBrokerMode.mockReturnValue(true);
    mockGetValidAccessToken.mockResolvedValue("AT-stdio");

    const handler = handlers.get("authenticate")!;
    const result = await handler();

    expect(mockStartBrokerLogin).not.toHaveBeenCalled();
    expect(mockGetValidAccessToken).toHaveBeenCalled();
    expect(result.content[0].text).toContain("Successfully authenticated");
  });
});

describe("logout — HTTP mode", () => {
  it("clears both tokens and any pending broker session", async () => {
    const clearTokens = vi.fn();
    const setPendingBrokerSession = vi.fn();
    mockGetSessionContext.mockReturnValue({
      sessionId: "http-sess-4",
      getTokens: () => ({ clio_user_id: "u-1" }),
      clearTokens,
      setPendingBrokerSession,
    });

    const handler = handlers.get("logout")!;
    await handler();

    expect(clearTokens).toHaveBeenCalled();
    expect(setPendingBrokerSession).toHaveBeenCalledWith(null);
  });
});
