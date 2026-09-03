import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGetAllPages, clioPost, ClioApiError } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const CUSTOM_FIELD_FIELDS =
  "id,name,field_type,parent_type,required,displayed,deleted,picklist_options{id,option}";

/** Same root cause for both directions: the developer app is missing custom field scope. */
function permissionErrorText(err: ClioApiError, verb: "read" | "write"): string {
  return (
    `Error: ${err.message}\n\nClio returned 403 for /custom_fields.json even with a valid token. ` +
    `This is typically the Clio developer application missing custom field ${verb} permission, not an ` +
    `account or user issue - open the application under Settings > Developer Applications in Clio and ` +
    `confirm it has custom fields access, then reconnect.`
  );
}

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
        if (err instanceof ClioApiError && err.statusCode === 403) {
          return {
            content: [{ type: "text", text: permissionErrorText(err, "read") }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "create_custom_field",
    {
      description:
        "Create a new custom field definition on this Clio account (Matter or Contact). Once created, set its value on a record with create_matter/update_matter's custom_field_values, using the returned id as custom_field_id.",
      inputSchema: {
        name: z.string().min(1).describe("Label shown for this field in Clio"),
        parent_type: z.enum(["Matter", "Contact"]).describe("Whether this field applies to matters or contacts"),
        field_type: z
          .string()
          .min(1)
          .describe(
            "Clio field type, e.g. text_line, text_area, checkbox, date, numeric, currency, email, url, or picklist. " +
              "Clio validates this server-side and returns a clear error for an unsupported value."
          ),
        required: z.boolean().default(false).describe("Whether this field must be filled in on the record"),
        displayed: z.boolean().default(true).describe("Whether this field is shown in Clio's UI (default true)"),
        picklist_options: z
          .array(z.string().min(1))
          .optional()
          .describe("Allowed option labels, only used when field_type is picklist"),
      },
    },
    async ({ name, parent_type, field_type, required, displayed, picklist_options }) => {
      // Never log `name` (or picklist option labels) - a firm can name a
      // field after a client or case detail, same rule as create_note's
      // subject/body and create_matter's description.
      const auditArgs = { parent_type, field_type, required, displayed };
      try {
        const data: Record<string, unknown> = { name, parent_type, field_type, required, displayed };
        if (picklist_options && picklist_options.length > 0) {
          data["picklist_options"] = picklist_options.map((option) => ({ option }));
        }

        const res = await clioPost("/custom_fields.json", { data });
        const f = res.data;

        await appendAuditLog({ tool: "create_custom_field", args: auditArgs, outcome: "success" });

        const result = {
          success: true,
          custom_field: {
            id: f.id,
            name: f.name,
            type: f.field_type,
            parent_type: f.parent_type,
            required: f.required ?? null,
            displayed: f.displayed ?? null,
            ...(Array.isArray(f.picklist_options) && f.picklist_options.length > 0 && {
              picklist_options: f.picklist_options.map((o: any) => ({ id: o.id, option: o.option })),
            }),
          },
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({ tool: "create_custom_field", args: auditArgs, outcome: "error", error_message: err.message });
        if (err instanceof ClioApiError && err.statusCode === 422) {
          return { content: [{ type: "text", text: `Validation error: ${err.message}` }], isError: true };
        }
        if (err instanceof ClioApiError && err.statusCode === 403) {
          return {
            content: [{ type: "text", text: permissionErrorText(err, "write") }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
