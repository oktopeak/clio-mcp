import { vi, describe, it, expect } from "vitest";

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    getPassword() { return null; }
    setPassword() {}
    deletePassword() {}
  },
}));

const EXPECTED_EXPORTS = [
  "AUDIT_ARG_ALLOWLIST", "AUTH_TOOLS", "CLIO_REGIONS", "CLIO_REGION_BASE_URLS", "ClioApiError", "ClioOAuthError",
  "DEFAULT_AUDIT_FILE", "DEFAULT_CLIO_REGION", "InvalidClioRegionError", "REDACTED", "REGISTRARS", "TOOL_META",
  "WRITE_TOOLS", "appendAuditLog", "buildClioAuthorizeUrl", "clioGet", "clioPatch", "clioPost", "clioPut",
  "configureAudit", "createFileAuditSink", "deriveCodeChallenge", "exchangeClioCode", "extractNextPageToken",
  "fetchClioWhoAmI", "generateCodeVerifier", "getClioApiBaseUrl", "getClioAuthorizeUrl", "getClioTokenUrl",
  "getSessionContext", "isClioRegion", "isReadOnlyEnv", "isStdioMode", "parseClioRegion", "readAuditLog",
  "redactAuditArgs", "refreshClioTokens", "registerAllTools", "registerResources", "requireSessionContext",
  "resetAudit", "resolveRegion", "runWithSessionContext", "sessionStorage", "singleFlight",
].sort();

describe("@oktopeak/clio-mcp/lib", () => {
  it("exports exactly the documented surface", async () => {
    const lib = await import("../lib.js");
    expect(Object.keys(lib).sort()).toEqual(EXPECTED_EXPORTS);
  });

  it("importing the library starts no timers and reads no env at load", async () => {
    const timers = vi.spyOn(globalThis, "setInterval");
    await import("../lib.js");
    expect(timers).not.toHaveBeenCalled();
    timers.mockRestore();
  });
});
