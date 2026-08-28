import { AsyncLocalStorage } from "async_hooks";
import type { ClioTokens } from "../auth/clioOAuth.js";

/**
 * Per-request identity and token access for everything that runs inside a
 * session (the built-in HTTP transport, or a host embedding the connector).
 * stdio mode never establishes a context: the tools fall back to the local
 * token file there, and nowhere else.
 */
export interface SessionContext {
  sessionId: string;
  /** Caller identity as known to the host (hosted deployments). Written to every audit entry. */
  userId?: string;
  /** Clio user id when the host already knows it; saves a token lookup per audit entry. */
  clioUserId?: string;
  /** Host request id, for correlating audit entries with request logs. */
  requestId?: string;
  getAccessToken(): Promise<string>;
  getTokens(): Promise<ClioTokens | null>;
  storeTokens(tokens: ClioTokens): Promise<void>;
  clearTokens(): Promise<void>;
  /** Present only when this connector owns the Clio login flow (built-in HTTP mode). Hosts that log users in themselves leave it out. */
  setPendingNonce?(nonce: string): void;
}

export const sessionStorage = new AsyncLocalStorage<SessionContext>();

export function getSessionContext(): SessionContext | undefined {
  return sessionStorage.getStore();
}

/** Run `fn` with `ctx` as the current session context. */
export function runWithSessionContext<T>(ctx: SessionContext, fn: () => Promise<T>): Promise<T> {
  return sessionStorage.run(ctx, fn);
}

/** True when the connector runs as a Claude Desktop child process (TRANSPORT=stdio). */
export function isStdioMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.TRANSPORT ?? "http").trim().toLowerCase() === "stdio";
}

/**
 * Fail-closed variant of getSessionContext(). Outside stdio mode a missing
 * context means some code path forgot to run inside the session, and silently
 * falling back to the shared single-user token file would leak one session's
 * Clio identity into another's request. Only stdio mode may return null.
 */
export function requireSessionContext(): SessionContext | null {
  const ctx = getSessionContext();
  if (!ctx && !isStdioMode()) {
    throw new Error(
      "Internal error: missing session context while not running in stdio mode. " +
      "Refusing to fall back to the shared token file."
    );
  }
  return ctx ?? null;
}
