export type StartupValidationResult = { ok: true } | { ok: false; message: string };

// Broker mode (TOKEN_BROKER_URL set) never needs CLIO_CLIENT_ID/CLIO_CLIENT_SECRET
// on the connector — the shared app's secret lives only on the broker. BYO mode
// keeps today's requirement unchanged.
export function validateAuthEnv(env: NodeJS.ProcessEnv): StartupValidationResult {
  if ((env.TOKEN_BROKER_URL ?? "").trim()) {
    return { ok: true };
  }

  const missing = (["CLIO_CLIENT_ID", "CLIO_CLIENT_SECRET"] as const).filter((k) => !env[k]);
  if (missing.length > 0) {
    return {
      ok: false,
      message: `[startup] Fatal: missing required env var(s): ${missing.join(", ")}. Check your .env file.`,
    };
  }

  return { ok: true };
}
