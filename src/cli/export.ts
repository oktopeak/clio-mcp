import { EXIT, parseExportArgs } from "./args.js";
import type { ExportArgs } from "./args.js";
import { AUTH_COMMAND, EXPORT_USAGE } from "./usage.js";
import { checkOutputFolder } from "./outputFolder.js";
import { validateAuthEnv } from "../config/startupValidation.js";
import { getClioRegion } from "../utils/clioRegion.js";
import type { ClioTokens } from "../auth/clioOAuth.js";

export interface ExportRunContext {
  args: ExportArgs;
  clioUserId: string | null;
}

export interface ExportDeps {
  env: NodeJS.ProcessEnv;
  loadTokens(): Promise<ClioTokens | null>;
  runEngine(ctx: ExportRunContext): Promise<number>;
  stdout(text: string): void;
  stderr(text: string): void;
}

async function resolveDeps(overrides: Partial<ExportDeps>): Promise<ExportDeps> {
  return {
    env: overrides.env ?? process.env,
    loadTokens: overrides.loadTokens ?? (await import("../auth/tokenStorage.js")).loadTokens,
    runEngine: overrides.runEngine ?? (await import("../export/engine.js")).runExportEngine,
    stdout: overrides.stdout ?? ((text) => void process.stdout.write(text)),
    stderr: overrides.stderr ?? ((text) => void process.stderr.write(text)),
  };
}

export async function runExport(argv: readonly string[], overrides: Partial<ExportDeps> = {}): Promise<number> {
  const deps = await resolveDeps(overrides);

  const parsed = parseExportArgs(argv);
  if (!parsed.ok) {
    deps.stderr(`${parsed.message}\n\n${EXPORT_USAGE}`);
    return EXIT.USAGE;
  }
  if (parsed.help) {
    deps.stdout(EXPORT_USAGE);
    return EXIT.OK;
  }
  const { args } = parsed;

  const authEnv = validateAuthEnv(deps.env);
  if (!authEnv.ok) {
    deps.stderr(`${authEnv.message}\n`);
    return EXIT.USAGE;
  }

  try {
    getClioRegion();
  } catch (err) {
    deps.stderr(`${err instanceof Error ? err.message : "Invalid CLIO_REGION."}\n`);
    return EXIT.USAGE;
  }

  let tokens: ClioTokens | null;
  try {
    tokens = await deps.loadTokens();
  } catch (err) {
    deps.stderr(`Could not read the saved Clio login: ${err instanceof Error ? err.message : "unknown error"}\n`);
    return EXIT.FATAL;
  }
  if (tokens === null) {
    deps.stderr(`Not logged in to Clio: run auth first (${AUTH_COMMAND}).\n`);
    return EXIT.NOT_LOGGED_IN;
  }

  const folder = await checkOutputFolder(args.out, { resume: args.resume });
  if (!folder.ok) {
    deps.stderr(`${folder.message}\n`);
    return EXIT.USAGE;
  }

  for (const name of args.notExported) {
    deps.stderr(`${name}: not exported in this version.\n`);
  }

  return deps.runEngine({ args, clioUserId: tokens.clio_user_id ?? null });
}
