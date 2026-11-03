import { DEFAULT_RATE, DEFAULT_CONCURRENCY, MAX_CONCURRENCY } from "./args.js";

// The standalone @oktopeak/clio-export package runs this same CLI. It sets these two
// variables before importing it, so the help text names the command the user typed.
export const AUTH_COMMAND = process.env.CLIO_EXPORT_AUTH_COMMAND ?? "npx @oktopeak/clio-mcp auth";
export const EXPORT_COMMAND = process.env.CLIO_EXPORT_COMMAND ?? "npx @oktopeak/clio-mcp export";

export const AUTH_USAGE = `Usage:
  ${AUTH_COMMAND}

Opens your browser to log in to Clio, saves the token (encrypted), and prints
who logged in and when the token expires.
`;

export const EXPORT_USAGE = `Usage:
  ${EXPORT_COMMAND} --out <folder> [options]

Reads your whole Clio account into data files and a folder tree. It never
writes to Clio and never opens a browser: run "auth" first.

Options:
  --out <folder>        Output folder. Must be empty or a previous export.
  --since <date>        Only records changed after this date, where Clio
                        supports it. A date (YYYY-MM-DD) is read as 00:00:00Z
                        minus 1 day, so the filter includes a little too much
                        rather than missing records. A full ISO datetime with
                        offset (2026-03-10T09:00:00+02:00) is used as given.
  --only <list>         Comma separated record types, for example
                        matters,folders,documents
  --no-documents        Skip documents and document files.
  --rate <n>            Requests per second (default ${DEFAULT_RATE}).
  --concurrency <n>     Parallel downloads (default ${DEFAULT_CONCURRENCY}, max ${MAX_CONCURRENCY}).
  --resume              Continue a previous run in the same folder.
  --dry-run             Only count records and documents and write REPORT.md
                        with an estimate. Nothing else is written to the folder.
  --help                Show this help.

Exit codes:
  0 done, 1 done with errors or incomplete, 2 bad usage, 3 not logged in,
  4 interrupted (resumable with --resume), 5 fatal error.
`;

export const USAGE = `${AUTH_USAGE}
${EXPORT_USAGE}`;
