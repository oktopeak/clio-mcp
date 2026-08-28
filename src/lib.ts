/**
 * Library entry point: `import { ... } from "@oktopeak/clio-mcp/lib"`.
 *
 * Everything a host needs to run the connector's tools inside its own server:
 * the tool registry, the session context seam, the audit sink, the pure Clio
 * OAuth functions and the region helpers. This module must never import
 * index.ts (dotenv, process.exit) or server/http.ts (module-level timer).
 */
export {
  registerAllTools,
  WRITE_TOOLS,
  AUTH_TOOLS,
  TOOL_META,
  REGISTRARS,
  isReadOnlyEnv,
} from "./tools/index.js";
export type { RegisterAllToolsOptions, ToolMeta } from "./tools/index.js";

export { registerResources } from "./resources/index.js";

export {
  sessionStorage,
  getSessionContext,
  requireSessionContext,
  runWithSessionContext,
  isStdioMode,
} from "./utils/sessionContext.js";
export type { SessionContext } from "./utils/sessionContext.js";

export {
  configureAudit,
  resetAudit,
  appendAuditLog,
  readAuditLog,
  createFileAuditSink,
  redactAuditArgs,
  AUDIT_ARG_ALLOWLIST,
  REDACTED,
  DEFAULT_AUDIT_FILE,
} from "./utils/auditLog.js";
export type {
  AuditEntry,
  AuditFilter,
  AuditReadResult,
  ReadAuditLogResult,
  AuditSink,
  RedactPolicy,
} from "./utils/auditLog.js";

export {
  buildClioAuthorizeUrl,
  exchangeClioCode,
  refreshClioTokens,
  fetchClioWhoAmI,
  generateCodeVerifier,
  deriveCodeChallenge,
  ClioOAuthError,
} from "./auth/clioOAuth.js";
export type { ClioTokens, ClioWhoAmI, ClioOAuthClient } from "./auth/clioOAuth.js";

export {
  resolveRegion,
  parseClioRegion,
  isClioRegion,
  getClioApiBaseUrl,
  getClioAuthorizeUrl,
  getClioTokenUrl,
  CLIO_REGIONS,
  CLIO_REGION_BASE_URLS,
  DEFAULT_CLIO_REGION,
  InvalidClioRegionError,
} from "./utils/clioRegion.js";
export type { ClioRegion } from "./utils/clioRegion.js";

export {
  ClioApiError,
  clioGet,
  clioPost,
  clioPatch,
  clioPut,
  extractNextPageToken,
} from "./utils/clioClient.js";

export { singleFlight } from "./utils/singleFlight.js";
