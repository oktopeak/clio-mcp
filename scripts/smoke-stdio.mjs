#!/usr/bin/env node
// Manual regression for the built stdio CLI: spawns build/index.js the way
// Claude Desktop does, lists the tools and reads the auth-status resource.
// Usage: npm run build && node scripts/smoke-stdio.mjs [--read-only]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const readOnly = process.argv.includes("--read-only");
const env = {
  ...process.env,
  CLIO_CLIENT_ID: process.env.CLIO_CLIENT_ID || "smoke-client-id",
  CLIO_CLIENT_SECRET: process.env.CLIO_CLIENT_SECRET || "smoke-client-secret",
  TRANSPORT: "stdio",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || "ab".repeat(32),
  HOME: mkdtempSync(join(tmpdir(), "clio-mcp-smoke-")),
  READ_ONLY: readOnly ? "true" : "",
};

const transport = new StdioClientTransport({ command: "node", args: ["build/index.js"], env, stderr: "pipe" });
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
const writes = names.filter((n) => ["create_note", "create_matter", "upload_document"].includes(n));
const annotated = tools.every((t) => typeof t.annotations?.readOnlyHint === "boolean" && typeof t.title === "string");
console.log(`READ_ONLY=${readOnly}: ${tools.length} tools, write tools present: ${writes.join(",") || "none"}, all annotated: ${annotated}`);

const res = await client.readResource({ uri: "clio://auth/status" });
console.log("auth-status resource:", res.contents[0].text.replace(/\s+/g, " "));

const expected = readOnly ? 17 : 26;
await client.close();
if (tools.length !== expected || !annotated || (readOnly && writes.length)) {
  console.error(`FAIL: expected ${expected} tools${readOnly ? " and no write tools" : ""}`);
  process.exit(1);
}
console.log("OK");
