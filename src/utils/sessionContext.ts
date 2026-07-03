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
