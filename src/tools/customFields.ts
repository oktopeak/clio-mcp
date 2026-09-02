import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGetAllPages } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const CUSTOM_FIELD_FIELDS =
  "id,name,field_type,parent_type,required,displayed,deleted,picklist_options{id,option}";

export function registerCustomFieldTools(server: McpServer): void {
  server.registerTool(
    "list_custom_fields",
    {
      description:
        "List the custom field definitions configured on this Clio account, with their types and (for picklists) their allowed options. Call this before reading or writing custom fields so you know what exists, what type each field is, and which option IDs a picklist accepts.",
      inputSchema: {
        parent_type: z
          .enum(["Matter", "Contact"])
          .optional()
          .describe("Only fields defined on matters, or only those on contacts. Omit for both."),
        include_deleted: z
          .boolean()
          .default(false)
          .describe("Include fields that have been deleted in Clio but still appear on historical records"),
      },
    },
    async ({ parent_type, include_deleted }) => {
      try {
        const params: Record<string, string> = { fields: CUSTOM_FIELD_FIELDS };
        if (parent_type) params["parent_type"] = parent_type;

        // Definitions are a small, bounded set and a partial list would send a
        // caller looking for a field that exists, so read all of it.
        const all = await clioGetAllPages("/custom_fields.json", params);
        const fields = include_deleted ? all : all.filter((f: any) => f.deleted !== true);

        await appendAuditLog({
          tool: "list_custom_fields",
          args: { parent_type, include_deleted },
          outcome: "success",
          result_count: fields.length,
        });

        if (fields.length === 0) {
          return { content: [{ type: "text", text: "No custom fields are configured on this account." }] };
        }

        const result = {
          custom_fields: fields.map((f: any) => ({
            id: f.id,
            name: f.name,
            type: f.field_type,
            parent_type: f.parent_type,
            required: f.required ?? null,
            displayed: f.displayed ?? null,
            ...(f.deleted === true && { deleted: true }),
            // Present only for picklists. These IDs are what a write to this
            // field expects as its value, and what a read returns raw.
            ...(Array.isArray(f.picklist_options) && f.picklist_options.length > 0 && {
              picklist_options: f.picklist_options.map((o: any) => ({ id: o.id, option: o.option })),
            }),
          })),
          total_count: fields.length,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "list_custom_fields",
          args: { parent_type, include_deleted },
          outcome: "error",
          error_message: err.message,
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
