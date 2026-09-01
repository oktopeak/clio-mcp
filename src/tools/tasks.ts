import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, clioPost, clioPatch, extractNextPageToken } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const TASK_FIELDS = "id,name,priority,due_at,status,assignee{id,name},matter{id,display_number},reminders{id,notification_method}";

const STATUS_MAP: Record<string, string> = { Pending: "pending", Complete: "complete", "In Progress": "in_progress", "In Review": "in_review", "Draft": "draft" };

export function registerTaskTools(server: McpServer): void {
  server.registerTool(
    "list_tasks",
    {
      description: "List tasks from Clio with optional filters",
      inputSchema: {
        matter_id: z.number().int().positive().optional().describe("Filter tasks by matter ID"),
        status: z.enum(["Pending", "Complete", "In Progress", "In Review", "Draft"]).optional().describe("Filter by task status"),
        due_date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date (YYYY-MM-DD) — tasks due on or after this date"),
        due_date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date (YYYY-MM-DD) — tasks due on or before this date"),
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1-200)"),
        page_token: z.string().optional().describe("Cursor from a previous list_tasks response to fetch the next page"),
      },
    },
    async ({ matter_id, status, due_date_start, due_date_end, limit, page_token }) => {
      try {
        const params: Record<string, string> = { fields: TASK_FIELDS, limit: String(limit) };
        if (matter_id) params["matter_id"] = String(matter_id);
        if (status) params["status"] = STATUS_MAP[status];
        if (due_date_start) params["due_at_from"] = due_date_start;
        if (due_date_end) params["due_at_to"] = due_date_end;
        if (page_token) params["page_token"] = page_token;

        const data = await clioGet("/tasks.json", params);
        const tasks = data.data as any[];
        const nextPageToken = tasks.length >= limit ? extractNextPageToken(data.meta) : null;

        await appendAuditLog({
          tool: "list_tasks",
          args: { matter_id, status, due_date_start, due_date_end, limit, page_token },
          outcome: "success",
          result_count: tasks?.length ?? 0,
          ...(matter_id && { matter_id }),
        });

        const result = {
          tasks: tasks.map((t) => ({
            id: t.id,
            name: t.name,
            priority: t.priority,
            due_date: t.due_at ? t.due_at.substring(0, 10) : null,
            status: t.status,
            assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
            matter: t.matter ? { id: t.matter.id, display_number: t.matter.display_number } : null,
            reminder: t.reminders?.length > 0
              ? { notification_method: t.reminders[0].notification_method }
              : null,
          })),
          total_count: data.meta?.records ?? tasks.length,
          has_more: nextPageToken !== null,
          next_page_token: nextPageToken,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "list_tasks",
          args: { matter_id, status, due_date_start, due_date_end, limit, page_token },
          outcome: "error",
          error_message: err.message,
          ...(matter_id && { matter_id }),
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "create_task",
    {
      description: "Create a task on a matter in Clio",
      inputSchema: {
        matter_id: z.number().int().positive().describe("Matter ID to associate the task with"),
        name: z.string().min(1).describe("Task name / description"),
        description: z.string().min(2).describe("Detailed description of the task"),
        priority: z.enum(["High", "Normal", "Low"]).default("Normal").describe("Task priority"),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date (YYYY-MM-DD) when the task is due"),
        assignee_id: z.number().int().positive().optional().describe("Clio user ID to assign the task to"),
      },
    },
    async ({ matter_id, name, description, priority, due_date, assignee_id }) => {
      try {
        const taskData: Record<string, unknown> = {
          name,
          description,
          priority,
          matter: { id: matter_id },
        };
        if (due_date) taskData["due_at"] = `${due_date}T00:00:00Z`; // midnight UTC — consistent with calendar tool convention
        if (assignee_id) taskData["assignee"] = { id: assignee_id, type: "User" };

        const data = await clioPost("/tasks.json", { data: taskData });
        const task = data.data;

        await appendAuditLog({
          tool: "create_task",
          args: { matter_id, name, priority, due_date, assignee_id },
          outcome: "success",
          matter_id,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              task: {
                id: task.id,
                name: task.name,
                priority: task.priority,
                due_at: task.due_at ? task.due_at.substring(0, 10) : null,
                matter_id,
              },
            }, null, 2),
          }],
        };
      } catch (err: any) {
        await appendAuditLog({
          tool: "create_task",
          args: { matter_id, name, priority, due_date, assignee_id },
          outcome: "error",
          error_message: err.message,
          matter_id,
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "update_task",
    {
      description: "Update one or more fields on an existing Clio task",
      inputSchema: {
        task_id: z.number().int().positive().describe("ID of the task to update"),
        name: z.string().min(1).optional().describe("New task name"),
        description: z.string().optional().describe("New task description"),
        priority: z.enum(["High", "Normal", "Low"]).optional().describe("New priority"),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date (YYYY-MM-DD) for due date"),
        status: z.enum(["Pending", "Complete", "In Progress", "In Review", "Draft"]).optional().describe("New task status"),
        assignee_id: z.number().int().positive().optional().describe("Clio user ID to reassign the task to"),
      },
    },
    async ({ task_id, name, description, priority, due_date, status, assignee_id }) => {
      if ([name, description, priority, due_date, status, assignee_id].every((v) => v === undefined)) {
        return { content: [{ type: "text", text: "Error: at least one field to update must be provided" }], isError: true };
      }
      try {
        const taskData: Record<string, unknown> = {};
        if (name !== undefined) taskData["name"] = name;
        if (description !== undefined) taskData["description"] = description;
        if (priority !== undefined) taskData["priority"] = priority;
        if (due_date !== undefined) taskData["due_at"] = `${due_date}T00:00:00Z`;
        if (status !== undefined) taskData["status"] = STATUS_MAP[status];
        if (assignee_id !== undefined) taskData["assignee"] = { id: assignee_id, type: "User" };

        const data = await clioPatch(`/tasks/${task_id}.json`, { data: taskData });
        const task = data.data;

        await appendAuditLog({
          tool: "update_task",
          args: { task_id, name, description, priority, due_date, status, assignee_id },
          outcome: "success",
          ...(task.matter?.id && { matter_id: task.matter.id }),
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              task: {
                id: task.id,
                name: task.name,
                priority: task.priority,
                status: task.status,
                due_date: task.due_at ? task.due_at.substring(0, 10) : null,
                matter_id: task.matter?.id ?? null,
              },
            }, null, 2),
          }],
        };
      } catch (err: any) {
        await appendAuditLog({
          tool: "update_task",
          args: { task_id, name, description, priority, due_date, status, assignee_id },
          outcome: "error",
          error_message: err.message,
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "complete_task",
    {
      description: "Mark a Clio task as complete",
      inputSchema: {
        task_id: z.number().int().positive().describe("ID of the task to mark complete"),
      },
    },
    async ({ task_id }) => {
      try {
        const data = await clioPatch(`/tasks/${task_id}.json`, { data: { status: STATUS_MAP["Complete"] } });
        const task = data.data;

        await appendAuditLog({
          tool: "complete_task",
          args: { task_id },
          outcome: "success",
          ...(task.matter?.id && { matter_id: task.matter.id }),
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              task: {
                id: task.id,
                name: task.name,
                status: task.status,
                completed_at: task.completed_at ?? null,
              },
            }, null, 2),
          }],
        };
      } catch (err: any) {
        await appendAuditLog({
          tool: "complete_task",
          args: { task_id },
          outcome: "error",
          error_message: err.message,
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
