import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@napi-rs/keyring", () => ({
  Entry: vi.fn().mockImplementation(function () {
    return { getPassword: () => null, setPassword: () => {} };
  }),
}));

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("../../auth/oauth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auth/oauth.js")>();
  return { ...actual, refreshTokensPure: mockRefresh };
});

import { buildSessionContext } from "../http.js";
import type { SessionRecord } from "../http.js";

function record(expiresInMs: number): SessionRecord {
  return {
    transport: null as any,
    mcpServer: null,
    tokens: { access_token: "old", refresh_token: "r0", expires_at: Date.now() + expiresInMs, clio_user_id: "u1" },
    pendingOAuthNonce: null,
    refreshInFlight: null,
    createdAt: Date.now(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildSessionContext", () => {
  it("returns the current token when it is not close to expiry", async () => {
    const ctx = buildSessionContext(record(60 * 60 * 1000), "s1");
    expect(await ctx.getAccessToken()).toBe("old");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("refreshes once for ten concurrent calls on an expiring token", async () => {
    let resolveRefresh!: (v: any) => void;
    mockRefresh.mockImplementation(() => new Promise((r) => { resolveRefresh = r; }));
    const rec = record(1000); // inside the 5-minute window
    const ctx = buildSessionContext(rec, "s1");

    const calls = Array.from({ length: 10 }, () => ctx.getAccessToken());
    await Promise.resolve();
    resolveRefresh({ access_token: "new", refresh_token: "r1", expires_at: Date.now() + 3_600_000 });
    const results = await Promise.all(calls);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(new Set(results)).toEqual(new Set(["new"]));
    expect(rec.tokens?.refresh_token).toBe("r1");
    expect(rec.tokens?.clio_user_id).toBe("u1");
    expect(rec.refreshInFlight).toBeNull();
  });

  it("exposes async token accessors and the clio user id", async () => {
    const rec = record(3_600_000);
    const ctx = buildSessionContext(rec, "s1");
    expect(ctx.clioUserId).toBe("u1");
    expect((await ctx.getTokens())?.access_token).toBe("old");
    await ctx.storeTokens({ access_token: "x", refresh_token: "y", expires_at: 1 });
    expect(rec.tokens?.access_token).toBe("x");
    await ctx.clearTokens();
    expect(rec.tokens).toBeNull();
    await expect(ctx.getAccessToken()).rejects.toThrow(/Not authenticated/);
  });
});
