import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const { mockLoadTokens, mockClearTokens, mockAppendAuditLog, mockGetValidAccessToken } = vi.hoisted(() => ({
  mockLoadTokens: vi.fn(),
  mockClearTokens: vi.fn(),
  mockAppendAuditLog: vi.fn(),
  mockGetValidAccessToken: vi.fn(),
}));

vi.mock("../tokenStorage.js", () => ({
  loadTokens: mockLoadTokens,
  clearTokens: mockClearTokens,
  saveTokens: vi.fn(),
}));
vi.mock("../../utils/auditLog.js", () => ({ appendAuditLog: mockAppendAuditLog }));
vi.mock("../oauth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../oauth.js")>();
  return { ...actual, getValidAccessToken: mockGetValidAccessToken };
});

import { registerAuthTools } from "../authTools.js";
import { runWithSessionContext } from "../../utils/sessionContext.js";
import type { SessionContext } from "../../utils/sessionContext.js";

const handlers: Record<string, Function> = {};
registerAuthTools({ registerTool: (name: string, _cfg: any, h: Function) => { handlers[name] = h; } } as any);

function ctx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "sess-1",
    getAccessToken: async () => "t",
    getTokens: async () => null,
    storeTokens: async () => {},
    clearTokens: async () => {},
    ...overrides,
  };
}

const original = process.env.TRANSPORT;
beforeEach(() => {
  vi.clearAllMocks();
  mockLoadTokens.mockResolvedValue(null);
  mockAppendAuditLog.mockResolvedValue(undefined);
  vi.stubEnv("CLIO_CLIENT_ID", "cid");
  vi.stubEnv("MCP_BASE_URL", "https://mcp.example.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (original === undefined) delete process.env.TRANSPORT;
  else process.env.TRANSPORT = original;
});

describe("auth_status", () => {
  it("stdio mode: reads the token file", async () => {
    process.env.TRANSPORT = "stdio";
    mockLoadTokens.mockResolvedValue({ access_token: "a", refresh_token: "r", expires_at: Date.now() + 600_000, clio_user_id: "u9" });
    const res = await handlers.auth_status();
    const body = JSON.parse(res.content[0].text);
    expect(body.authenticated).toBe(true);
    expect(body.clio_user_id).toBe("u9");
    expect(body.token_expired).toBe(false);
  });

  it("session mode: awaits the context tokens and never touches the file", async () => {
    process.env.TRANSPORT = "http";
    const res = await runWithSessionContext(
      ctx({ getTokens: async () => ({ access_token: "a", refresh_token: "r", expires_at: Date.now() - 1, clio_user_id: "u1" }) }),
      () => handlers.auth_status()
    );
    const body = JSON.parse(res.content[0].text);
    expect(body.authenticated).toBe(true);
    expect(body.token_expired).toBe(true);
    expect(mockLoadTokens).not.toHaveBeenCalled();
  });
});

describe("authenticate", () => {
  it("session mode with a login flow: returns the Clio URL and stores the nonce", async () => {
    process.env.TRANSPORT = "http";
    const setPendingNonce = vi.fn();
    const res = await runWithSessionContext(ctx({ setPendingNonce }), () => handlers.authenticate());
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toMatch(/https:\/\/app\.clio\.com\/oauth\/authorize/);
    expect(setPendingNonce).toHaveBeenCalledTimes(1);
  });

  it("session mode without a login flow (hosted): explains that the host manages login", async () => {
    process.env.TRANSPORT = "http";
    const res = await runWithSessionContext(ctx(), () => handlers.authenticate());
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/hosting service/i);
    expect(mockGetValidAccessToken).not.toHaveBeenCalled();
  });

  it("stdio mode: runs the browser flow", async () => {
    process.env.TRANSPORT = "stdio";
    mockGetValidAccessToken.mockResolvedValue("tok");
    const res = await handlers.authenticate();
    expect(res.isError).toBeUndefined();
    expect(mockGetValidAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe("logout", () => {
  it("session mode: awaits clearTokens on the context", async () => {
    process.env.TRANSPORT = "http";
    const clear = vi.fn(async () => {});
    const res = await runWithSessionContext(
      ctx({ clearTokens: clear, getTokens: async () => ({ access_token: "a", refresh_token: "r", expires_at: 1, clio_user_id: "u2" }) }),
      () => handlers.logout()
    );
    expect(res.isError).toBeUndefined();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(mockClearTokens).not.toHaveBeenCalled();
    expect(mockAppendAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tool: "logout", clio_user_id: "u2" }));
  });

  it("stdio mode: clears the token file", async () => {
    process.env.TRANSPORT = "stdio";
    mockClearTokens.mockResolvedValue(undefined);
    await handlers.logout();
    expect(mockClearTokens).toHaveBeenCalledTimes(1);
  });
});
