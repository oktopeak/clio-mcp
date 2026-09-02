import { describe, it, expect, afterEach } from "vitest";
import {
  getSessionContext,
  requireSessionContext,
  runWithSessionContext,
  isStdioMode,
} from "../sessionContext.js";
import type { SessionContext } from "../sessionContext.js";

const original = process.env.TRANSPORT;
afterEach(() => {
  if (original === undefined) delete process.env.TRANSPORT;
  else process.env.TRANSPORT = original;
});

function ctx(): SessionContext {
  return {
    sessionId: "s1",
    getAccessToken: async () => "t",
    getTokens: async () => null,
    storeTokens: async () => {},
    clearTokens: async () => {},
  };
}

describe("isStdioMode", () => {
  it.each(["stdio", "STDIO", " stdio "])("is true for %j", (v) => {
    expect(isStdioMode({ TRANSPORT: v } as NodeJS.ProcessEnv)).toBe(true);
  });
  it.each(["http", "", undefined])("is false for %j", (v) => {
    expect(isStdioMode({ TRANSPORT: v } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("requireSessionContext", () => {
  it("throws outside a session when the transport is not stdio", () => {
    process.env.TRANSPORT = "http";
    expect(() => requireSessionContext()).toThrow(/missing session context/i);
  });

  it("throws when TRANSPORT is unset (defaults to http)", () => {
    delete process.env.TRANSPORT;
    expect(() => requireSessionContext()).toThrow();
  });

  it("returns null outside a session in stdio mode", () => {
    process.env.TRANSPORT = "stdio";
    expect(requireSessionContext()).toBeNull();
  });

  it("returns the context inside runWithSessionContext, whatever the transport", async () => {
    process.env.TRANSPORT = "http";
    const c = ctx();
    const seen = await runWithSessionContext(c, async () => requireSessionContext());
    expect(seen).toBe(c);
    expect(getSessionContext()).toBeUndefined();
  });
});
