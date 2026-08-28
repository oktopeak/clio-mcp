import { AsyncLocalStorage } from "async_hooks";
import type { ClioTokens } from "../auth/oauth.js";

export interface SessionContext {
  sessionId: string;
  /** Caller identity as known to the host (hosted deployments). Written to every audit entry. */
  userId?: string;
  /** Clio user id when the host already knows it; saves a token lookup per audit entry. */
  clioUserId?: string;
  /** Host request id, for correlating audit entries with request logs. */
  requestId?: string;
  getAccessToken(): Promise<string>;
  storeTokens(tokens: ClioTokens): void;
  getTokens(): ClioTokens | null;
  clearTokens(): void;
  setPendingNonce(nonce: string): void;
}

export const sessionStorage = new AsyncLocalStorage<SessionContext>();

export function getSessionContext(): SessionContext | undefined {
  return sessionStorage.getStore();
}

/** True when the connector runs as a Claude Desktop child process (TRANSPORT=stdio). */
export function isStdioMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.TRANSPORT ?? "http").trim().toLowerCase() === "stdio";
}
