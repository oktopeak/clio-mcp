import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const BILL_FIELDS = "id,number,issued_at,due_at,balance,total,state";

export function registerBillingTools(server: McpServer): void {
  server.registerTool(
    "get_billing_summary",
    {
      description: "Get a billing summary for a matter — total billed, outstanding balance, and last invoice date",
      inputSchema: {
        matter_id: z.number().int().positive().describe("The Clio matter ID"),
      },
    },
    async ({ matter_id }) => {
      try {
        const data = await clioGet("/bills.json", {
          matter_id: String(matter_id),
          fields: BILL_FIELDS,
          limit: "200",
        });
        const bills = data.data as any[];

        const activeBills = bills.filter((b) => b.state !== "draft" && b.state !== "void");
        const total_billed = activeBills.reduce((s: number, b: any) => s + (b.total ?? 0), 0);
        const total_outstanding = activeBills.reduce((s: number, b: any) => s + (b.balance ?? 0), 0);
        const last_invoice_date =
          activeBills
            .map((b: any) => b.issued_at)
            .filter(Boolean)
            .sort()
            .at(-1) ?? null;

        const result = {
          matter_id,
          bill_count: activeBills.length,
          total_billed,
          total_outstanding,
          last_invoice_date,
        };

        await appendAuditLog({ tool: "get_billing_summary", args: { matter_id }, outcome: "success", matter_id });

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({ tool: "get_billing_summary", args: { matter_id }, outcome: "error", error_message: err.message, matter_id });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
