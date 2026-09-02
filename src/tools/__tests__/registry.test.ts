import { vi, describe, it, expect } from "vitest";

// tokenStorage pulls in the native keyring binding through authTools; stub it
// the same way http.test.ts does so the registry can be exercised in-process.
vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    getPassword() { return null; }
    setPassword() {}
    deletePassword() {}
  },
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  registerAllTools,
  isReadOnlyEnv,
  WRITE_TOOLS,
  AUTH_TOOLS,
  TOOL_META,
} from "../index.js";
import type { RegisterAllToolsOptions } from "../index.js";

/**
 * Derived from TOOL_META rather than hand-listed: the invariant worth testing is
 * that the registry, TOOL_META and what the server actually exposes agree. A
 * literal list here only tests that someone remembered to edit two places.
 */
const ALL_TOOLS = Object.keys(TOOL_META).sort();

async function listTools(opts?: RegisterAllToolsOptions) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const registered = registerAllTools(server, opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  return { client, server, tools, registered };
}

describe("registerAllTools", () => {
  it("registers exactly the tools TOOL_META declares", async () => {
    const { tools, registered } = await listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);
    expect(registered.size).toBe(ALL_TOOLS.length);
  });

  it("every registered tool has an entry in TOOL_META", async () => {
    const { tools } = await listTools();
    for (const t of tools) {
      expect(TOOL_META[t.name], `TOOL_META is missing "${t.name}"`).toBeDefined();
    }
  });

  it("injects a title and MCP annotations on every tool", async () => {
    const { tools } = await listTools();
    for (const t of tools) {
      expect(typeof t.title).toBe("string");
      expect(t.title!.length).toBeGreaterThan(0);
      expect(typeof t.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof t.annotations?.destructiveHint).toBe("boolean");
      if (WRITE_TOOLS.has(t.name)) {
        expect(t.annotations?.readOnlyHint, `${t.name} is a write tool`).toBe(false);
      } else if (!AUTH_TOOLS.has(t.name)) {
        expect(t.annotations?.readOnlyHint, `${t.name} is a read tool`).toBe(true);
      }
    }
  });

  it("readOnly hides exactly the write tools", async () => {
    const { tools } = await listTools({ readOnly: true });
    const names = new Set(tools.map((t) => t.name));
    expect(tools).toHaveLength(ALL_TOOLS.length - WRITE_TOOLS.size);
    for (const w of WRITE_TOOLS) expect(names.has(w), `${w} must be hidden`).toBe(false);
    expect(names.has("authenticate")).toBe(true);
    expect(names.has("auth_status")).toBe(true);
  });

  it("readOnly makes write tools unreachable, not just hidden", async () => {
    const { client } = await listTools({ readOnly: true });
    const result = await client.callTool({ name: "create_note", arguments: { matter_id: 1, subject: "x", body: "y" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/create_note not found/);
  });

  it('auth: "status" keeps auth_status and drops the login-flow tools', async () => {
    const { tools } = await listTools({ auth: "status" });
    const names = new Set(tools.map((t) => t.name));
    expect(tools).toHaveLength(ALL_TOOLS.length - 2);
    expect(names.has("auth_status")).toBe(true);
    expect(names.has("authenticate")).toBe(false);
    expect(names.has("logout")).toBe(false);
  });

  it('auth: "none" drops all three auth tools', async () => {
    const { tools } = await listTools({ auth: "none" });
    const names = new Set(tools.map((t) => t.name));
    expect(tools).toHaveLength(ALL_TOOLS.length - AUTH_TOOLS.size);
    for (const a of AUTH_TOOLS) expect(names.has(a)).toBe(false);
  });

  it("exclude leaves named tools unregistered", async () => {
    const { tools } = await listTools({ exclude: ["upload_document", "export_audit_log"] });
    const names = new Set(tools.map((t) => t.name));
    expect(tools).toHaveLength(ALL_TOOLS.length - 2);
    expect(names.has("upload_document")).toBe(false);
    expect(names.has("export_audit_log")).toBe(false);
  });

  it("resources: false skips the resources without touching tools", async () => {
    const { client, tools } = await listTools({ resources: false });
    expect(tools).toHaveLength(ALL_TOOLS.length);
    await expect(client.listResources()).rejects.toThrow();
  });
});

describe("isReadOnlyEnv", () => {
  it.each(["true", "TRUE", " 1 ", "yes"])("accepts %j", (v) => {
    expect(isReadOnlyEnv({ READ_ONLY: v } as NodeJS.ProcessEnv)).toBe(true);
  });
  it.each(["", "false", "0", "no", "on", undefined])("rejects %j", (v) => {
    expect(isReadOnlyEnv({ READ_ONLY: v } as NodeJS.ProcessEnv)).toBe(false);
  });
});
