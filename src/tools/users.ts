import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, ClioApiError, extractNextPageToken } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const USER_LIST_FIELDS = "id,name,email,enabled,subscription_type,initials";
const USER_DETAIL_FIELDS = "id,name,email,enabled,subscription_type,initials,created_at,updated_at";

export function registerUserTools(server: McpServer): void {
  server.registerTool(
    "list_users",
    {
      description:
        "List Clio firm users (attorneys and staff) with their IDs. Use this to look up user IDs needed for create_matter (responsible_attorney_id, originating_attorney_id) and other tools.",
      inputSchema: {
        name: z.string().optional().describe("Filter by name (partial match)"),
        subscription_type: z
          .enum(["attorney", "nonattorney"])
          .optional()
          .describe("Filter to attorneys only or non-attorneys only"),
        enabled: z
          .boolean()
          .optional()
          .describe("Return only enabled (active) accounts (omit to return all)"),
        limit: z.number().int().min(1).max(2000).default(200).describe("Max results to return (1-2000)"),
        page_token: z.string().optional().describe("Cursor from a previous list_users response to fetch the next page"),
      },
    },
    async ({ name, subscription_type, enabled, limit, page_token }) => {
      try {
        const params: Record<string, string> = {
          fields: USER_LIST_FIELDS,
          limit: String(limit),
        };
        if (enabled !== undefined) params.enabled = String(enabled);
        if (name) params.name = name;
        if (subscription_type) params.subscription_type = subscription_type;
        if (page_token) params.page_token = page_token;

        const data = await clioGet("/users.json", params);
        const users = data.data as any[];
        const nextPageToken = users.length >= limit ? extractNextPageToken(data.meta) : null;

        await appendAuditLog({
          tool: "list_users",
          args: { name, subscription_type, enabled, limit, page_token },
          outcome: "success",
          result_count: users?.length ?? 0,
        });

        const result = {
          users: users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email ?? null,
            initials: u.initials ?? null,
            subscription_type: u.subscription_type ?? null,
            enabled: u.enabled,
          })),
          total_count: data.meta?.records ?? users.length,
          has_more: nextPageToken !== null,
          next_page_token: nextPageToken,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "list_users",
          args: { name, subscription_type, enabled, limit, page_token },
          outcome: "error",
          error_message: err.message,
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_user",
    {
      description: "Get details for a single Clio user by their user ID",
      inputSchema: {
        user_id: z.number().int().positive().describe("The Clio user ID"),
      },
    },
    async ({ user_id }) => {
      try {
        const data = await clioGet(`/users/${user_id}.json`, { fields: USER_DETAIL_FIELDS });
        const u = data.data;

        const result = {
          id: u.id,
          name: u.name,
          email: u.email ?? null,
          initials: u.initials ?? null,
          subscription_type: u.subscription_type ?? null,
          enabled: u.enabled,
          created_at: u.created_at,
          updated_at: u.updated_at,
        };

        await appendAuditLog({ tool: "get_user", args: { user_id }, outcome: "success" });

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        if (err instanceof ClioApiError && err.statusCode === 404) {
          await appendAuditLog({ tool: "get_user", args: { user_id }, outcome: "not_found", result_count: 0 });
          return { content: [{ type: "text", text: `User ${user_id} not found.` }] };
        }
        await appendAuditLog({ tool: "get_user", args: { user_id }, outcome: "error", error_message: err.message });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
