import { describe, it, expect } from "vitest";
import { resolveHttpAuthConfig, isAuthorized, MIN_API_KEY_LENGTH, PUBLIC_PATHS } from "../httpAuth.js";

const GOOD_KEY = "a".repeat(32);

describe("resolveHttpAuthConfig", () => {
  it("accepts a key of at least 24 characters", () => {
    expect(resolveHttpAuthConfig({ MCP_API_KEY: GOOD_KEY })).toEqual({ apiKey: GOOD_KEY });
    expect(resolveHttpAuthConfig({ MCP_API_KEY: "x".repeat(MIN_API_KEY_LENGTH) })).toEqual({
      apiKey: "x".repeat(MIN_API_KEY_LENGTH),
    });
  });

  it("trims surrounding whitespace from the key", () => {
    expect(resolveHttpAuthConfig({ MCP_API_KEY: `  ${GOOD_KEY}\n` })).toEqual({ apiKey: GOOD_KEY });
  });

  it("refuses to start when the key is missing", () => {
    expect(() => resolveHttpAuthConfig({})).toThrow(/MCP_API_KEY is required in HTTP mode/);
    expect(() => resolveHttpAuthConfig({ MCP_API_KEY: "" })).toThrow(/MCP_API_KEY is required in HTTP mode/);
    expect(() => resolveHttpAuthConfig({ MCP_API_KEY: "   " })).toThrow(/MCP_API_KEY is required in HTTP mode/);
  });

  it("refuses to start when the key is shorter than 24 characters", () => {
    expect(() => resolveHttpAuthConfig({ MCP_API_KEY: "short" })).toThrow(/too short \(5 characters\)/);
    expect(() => resolveHttpAuthConfig({ MCP_API_KEY: "x".repeat(23) })).toThrow(/at least 24 characters/);
  });

  it("does not let the opt-out flag rescue a key that is too short", () => {
    expect(() =>
      resolveHttpAuthConfig({ MCP_API_KEY: "short", MCP_ALLOW_UNAUTHENTICATED: "true" })
    ).toThrow(/too short/);
  });

  it("allows an unauthenticated server only with MCP_ALLOW_UNAUTHENTICATED=true", () => {
    expect(resolveHttpAuthConfig({ MCP_ALLOW_UNAUTHENTICATED: "true" })).toEqual({ apiKey: null });
    expect(resolveHttpAuthConfig({ MCP_ALLOW_UNAUTHENTICATED: " TRUE " })).toEqual({ apiKey: null });
  });

  it("ignores other truthy-looking values for the opt-out flag", () => {
    for (const value of ["1", "yes", "on", "false", ""]) {
      expect(() => resolveHttpAuthConfig({ MCP_ALLOW_UNAUTHENTICATED: value })).toThrow(/MCP_API_KEY is required/);
    }
  });

  it("keeps enforcing the key when both the key and the opt-out flag are set", () => {
    expect(resolveHttpAuthConfig({ MCP_API_KEY: GOOD_KEY, MCP_ALLOW_UNAUTHENTICATED: "true" })).toEqual({
      apiKey: GOOD_KEY,
    });
  });

  it("points the operator at the fix in the error message", () => {
    let message = "";
    try { resolveHttpAuthConfig({}); } catch (err: any) { message = err.message; }
    expect(message).toContain("openssl rand -hex 32");
    expect(message).toContain("MCP_ALLOW_UNAUTHENTICATED=true");
    expect(message).toContain("TRANSPORT=stdio");
  });
});

describe("isAuthorized", () => {
  const config = { apiKey: GOOD_KEY };

  it("accepts the exact bearer token", () => {
    expect(isAuthorized(config, `Bearer ${GOOD_KEY}`)).toBe(true);
  });

  it("rejects a missing, wrong, truncated, or differently-schemed header", () => {
    expect(isAuthorized(config, undefined)).toBe(false);
    expect(isAuthorized(config, "")).toBe(false);
    expect(isAuthorized(config, `Bearer ${"b".repeat(32)}`)).toBe(false);
    expect(isAuthorized(config, `Bearer ${GOOD_KEY.slice(0, -1)}`)).toBe(false);
    expect(isAuthorized(config, `Bearer ${GOOD_KEY}x`)).toBe(false);
    expect(isAuthorized(config, `Basic ${GOOD_KEY}`)).toBe(false);
    expect(isAuthorized(config, GOOD_KEY)).toBe(false);
  });

  it("accepts anything when unauthenticated mode was explicitly enabled", () => {
    expect(isAuthorized({ apiKey: null }, undefined)).toBe(true);
    expect(isAuthorized({ apiKey: null }, "Bearer whatever")).toBe(true);
  });
});

describe("PUBLIC_PATHS", () => {
  it("only exempts the health probe and the OAuth redirect target", () => {
    expect([...PUBLIC_PATHS].sort()).toEqual(["/health", "/oauth/callback"]);
  });
});
