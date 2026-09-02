import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, extractNextPageToken } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const RELATIONSHIP_FIELDS =
  "id,description,type,contact{id,name,type,primary_email_address,primary_phone_number},matter{id,display_number}";

export function registerRelationshipTools(server: McpServer): void {
  server.registerTool(
    "list_matter_relationships",
    {
      description:
        "List the contacts attached to a matter and the role each one plays (co-counsel, expert, fact witness, opposing counsel, and any other relationship types the firm has configured). The matter's own client is a separate field on the matter and is not returned here.",
      inputSchema: {
        matter_id: z.number().int().positive().describe("Matter whose related contacts to list"),
        limit: z.number().int().min(1).max(200).default(100).describe("Max results to return (1-200)"),
        page_token: z
          .string()
          .optional()
          .describe("Cursor from a previous list_matter_relationships response to fetch the next page"),
      },
    },
    async ({ matter_id, limit, page_token }) => {
      try {
        const params: Record<string, string> = {
          fields: RELATIONSHIP_FIELDS,
          matter_id: String(matter_id),
          limit: String(limit),
        };
        if (page_token) params["page_token"] = page_token;

        const data = await clioGet("/relationships.json", params);
        const relationships = (data.data ?? []) as any[];
        const nextPageToken = relationships.length >= limit ? extractNextPageToken(data.meta) : null;

        await appendAuditLog({
          tool: "list_matter_relationships",
          args: { matter_id, limit, page_token },
          outcome: "success",
          result_count: relationships.length,
          matter_id,
        });

        if (relationships.length === 0) {
          return { content: [{ type: "text", text: `No related contacts found on matter ${matter_id}.` }] };
        }

        const result = {
          relationships: relationships.map((r) => ({
            id: r.id,
            // Clio exposes the label the firm chose for this role under either
            // `description` or `type` depending on how it was configured, so
            // surface whichever is populated rather than picking one blindly.
            role: r.description ?? r.type ?? null,
            contact: r.contact
              ? {
                  id: r.contact.id,
                  name: r.contact.name,
                  type: r.contact.type ?? null,
                  email: r.contact.primary_email_address ?? null,
                  phone: r.contact.primary_phone_number ?? null,
                }
              : null,
          })),
          total_count: data.meta?.records ?? relationships.length,
          has_more: nextPageToken !== null,
          next_page_token: nextPageToken,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "list_matter_relationships",
          args: { matter_id, limit, page_token },
          outcome: "error",
          error_message: err.message,
          matter_id,
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
