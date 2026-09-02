/**
 * Coalesce concurrent calls: while one invocation of `fn` is in flight, every
 * caller awaits that same promise instead of starting another. Used around
 * token refresh so two overlapping tool calls cannot both refresh and have the
 * loser overwrite the winner's tokens.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    inFlight = fn().finally(() => { inFlight = null; });
    return inFlight;
  };
}
