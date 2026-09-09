import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGetAllPages, ClioApiError } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

/**
 * Matter stages: the firm's own pipeline (Pre-Suit, Discovery, Settlement) and,
 * in most Clio setups, what fires the workflows and task lists attached to each
 * step when a human moves a matter in the UI. Whether an API-driven stage change
 * fires the same automation is UNVERIFIED and deliberately not claimed anywhere
 * a caller can read it. Reading stages is what lets a skill say "this matter is
 * in Discovery with nothing calendared" rather than just "this matter is quiet".
 *
 * No `fields` parameter on purpose. Clio validates that string strictly and
 * answers an unknown entry with a 400 for the whole request, which is how 2.2.0
 * broke every matter read. Nobody here has called /matter_stages.json against a
 * live account, so guessing at attribute names on it would be the same bet
 * twice. Stages are a small bounded config set, so Clio's defaults are cheap and
 * cannot be wrong. The mapping below reads whichever practice-area shape comes
 * back rather than assuming one.
 */
export function registerMatterStageTools(server: McpServer): void {
  server.registerTool(
    "list_matter_stages",
    {
      description:
        "List the matter stages (e.g. Pre-Suit, Discovery, Settlement) configured on this Clio account, in pipeline order per practice area. Call this before setting matter_stage_id on create_matter/update_matter so you know what stages exist and their IDs. Clio can attach workflows and task lists to a stage, but whether a stage change made through the API fires them has NOT been verified - confirm on one matter before relying on it.",
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
        const params: Record<string, string> = {};
        if (practice_area_id !== undefined) params["practice_area_id"] = String(practice_area_id);

        // Stages are a small, bounded config set like custom fields, and a
        // partial page would send a caller looking for a stage that exists.
        const stages = await clioGetAllPages("/matter_stages.json", params);

        await appendAuditLog({
          tool: "list_matter_stages",
          args: { practice_area_id },
          outcome: "success",
          result_count: stages.length,
        });

        if (stages.length === 0) {
          return { content: [{ type: "text", text: "No matter stages are configured on this account." }] };
        }

        const mapped = stages.map((s: any) => ({
          id: s?.id ?? null,
          name: s?.name ?? null,
          practice_area_id: s?.practice_area_id ?? s?.practice_area?.id ?? null,
          practice_area: s?.practice_area?.name ?? null,
          order: typeof s?.order === "number" ? s.order : null,
        }));

        // Grouped by practice area, then in the firm's own pipeline order. Nulls
        // sort last rather than turning the comparison into NaN, which is what
        // subtracting a missing id would do.
        const byNumber = (a: number | null, b: number | null) =>
          a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;
        mapped.sort(
          (a, b) =>
            byNumber(a.practice_area_id, b.practice_area_id) ||
            byNumber(a.order, b.order) ||
            (a.name ?? "").localeCompare(b.name ?? "")
        );

        const result = { matter_stages: mapped, total_count: mapped.length };
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
              text:
                `Error: ${err.message}\n\nClio refused /matter_stages.json with a 403 even though the token ` +
                `is valid. The likeliest reason is that the connecting Clio user's permission set does not ` +
                `cover matter stages, so a Clio administrator is the place to start. If that is already in ` +
                `place, please open an issue at https://github.com/oktopeak/clio-mcp/issues with your region ` +
                `and the exact response.`,
            }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
