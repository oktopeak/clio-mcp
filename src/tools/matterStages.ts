import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGetAllPages, ClioApiError } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const MATTER_STAGE_FIELDS = "id,name,practice_area_id,order";

export function registerMatterStageTools(server: McpServer): void {
  server.registerTool(
    "list_matter_stages",
    {
      description:
        "List the matter stages (e.g. Pre-Suit, Discovery, Settlement) configured on this Clio account, in pipeline order per practice area. Call this before setting matter_stage_id on create_matter/update_matter so you know what stages exist and their IDs. Moving a matter into a stage can trigger Clio workflows/tasks for that stage.",
      inputSchema: {
        practice_area_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Only stages for this practice area. Omit to list stages for every practice area."),
      },
    },
    async ({ practice_area_id }) => {
      try {
        const params: Record<string, string> = { fields: MATTER_STAGE_FIELDS };
        if (practice_area_id !== undefined) params["practice_area_id"] = String(practice_area_id);

        // Stages are a small, bounded config set like custom fields, so a
        // partial page would mislead a caller checking what stages exist.
        const stages = await clioGetAllPages("/matter_stages.json", params);
        stages.sort((a: any, b: any) => (a.practice_area_id - b.practice_area_id) || (a.order - b.order));

        await appendAuditLog({
          tool: "list_matter_stages",
          args: { practice_area_id },
          outcome: "success",
          result_count: stages.length,
        });

        if (stages.length === 0) {
          return { content: [{ type: "text", text: "No matter stages are configured on this account." }] };
        }

        const result = {
          matter_stages: stages.map((s: any) => ({
            id: s.id,
            name: s.name,
            practice_area_id: s.practice_area_id,
            order: s.order,
          })),
          total_count: stages.length,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "list_matter_stages",
          args: { practice_area_id },
          outcome: "error",
          error_message: err.message,
        });
        if (err instanceof ClioApiError && err.statusCode === 403) {
          return {
            content: [{
              type: "text",
              text: `Error: ${err.message}\n\nClio returned 403 for /matter_stages.json even with a valid token. ` +
                `This is typically the Clio developer application missing matter stage read permission, not an ` +
                `account or user issue - open the application under Settings > Developer Applications in Clio and ` +
                `confirm it has matters access, then reconnect.`,
            }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
