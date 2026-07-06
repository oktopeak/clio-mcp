import { AsyncLocalStorage } from "async_hooks";
import type { ClioTokens } from "../auth/oauth.js";

export interface PendingBrokerSession {
  brokerSessionId: string;
  codeVerifier: string;
}

export interface SessionContext {
  sessionId: string;
  getAccessToken(): Promise<string>;
  storeTokens(tokens: ClioTokens): void;
  getTokens(): ClioTokens | null;
  clearTokens(): void;
  setPendingNonce(nonce: string): void;
  setPendingBrokerSession(session: PendingBrokerSession | null): void;
  getPendingBrokerSession(): PendingBrokerSession | null;
}

export const sessionStorage = new AsyncLocalStorage<SessionContext>();

export function getSessionContext(): SessionContext | undefined {
  return sessionStorage.getStore();
}

export function isStdioMode(): boolean {
  return (process.env.TRANSPORT ?? "http").toLowerCase() === "stdio";
}

// Fail-closed variant of getSessionContext(): in HTTP mode a missing context
// means some code path forgot to run inside sessionStorage.run(...), and
// silently falling back to the shared single-user token file would leak one
// session's Clio identity into another's request. Only stdio mode (which
// never establishes a session context) is allowed to return null.
export function requireSessionContext(): SessionContext | null {
  const ctx = getSessionContext();
  if (!ctx && !isStdioMode()) {
    throw new Error(
      "Internal error: missing session context while running in HTTP mode. Refusing to fall back to shared token storage."
    );
  }
  return ctx ?? null;
}
