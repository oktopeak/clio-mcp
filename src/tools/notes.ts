import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioPost } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

export function registerNoteTools(server: McpServer): void {
  server.registerTool(
    "create_note",
    {
      description: "Create a note on a matter in Clio",
      inputSchema: {
        matter_id: z.number().int().positive().describe("Matter ID to attach the note to"),
        subject: z.string().min(1).describe("Note subject / title"),
        body: z.string().min(1).describe("Note body text"),
      },
    },
    async ({ matter_id, subject, body }) => {
      try {
        const data = await clioPost("/notes.json", {
          data: {
            subject,
            detail: body,
            detail_text_type: "plain_text",
            type: "Matter",
            matter: { id: matter_id },
          },
        });
        const note = data.data;

        await appendAuditLog({
          tool: "create_note",
          args: { matter_id, subject },
          outcome: "success",
          matter_id,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              note: {
                id: note.id,
                subject: note.subject,
                matter_id,
              },
            }, null, 2),
          }],
        };
      } catch (err: any) {
        await appendAuditLog({
          tool: "create_note",
          args: { matter_id, subject },
          outcome: "error",
          error_message: err.message,
          matter_id,
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
