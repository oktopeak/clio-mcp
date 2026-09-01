import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, clioGetAllPages, clioPost, ClioApiError, extractNextPageToken } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

const FOLDER_LIST_FIELDS = "id,name,parent{id,type},created_at,matter{id,display_number}";

type ParentRef = { id: number; type: "Matter" | "Folder" };

/**
 * Resolves a caller-supplied (matter_id | parent_folder_id) into the exact
 * {id, type} shape Clio expects on a folder's `parent`.
 *
 * Deliberately does NOT introspect an existing folder's own `parent.type` to
 * decide what to send here — that field describes what a folder's parent
 * already is, and reading it back to drive a write is exactly the mistake
 * that causes false negatives elsewhere (a matter's document root can itself
 * be modeled as a Folder node, so its children report parent.type "Folder",
 * not "Matter"). Instead we key off which kind of id the caller supplied,
 * which is unambiguous by construction and mirrors upload_document's proven
 * `type: "Matter"` behavior for matter-root writes.
 */
function resolveParentRef(matterId?: number, parentFolderId?: number): ParentRef {
  if (matterId && parentFolderId) {
    throw new Error("Provide exactly one of matter_id or parent_folder_id, not both.");
  }
  if (matterId) return { id: matterId, type: "Matter" };
  if (parentFolderId) return { id: parentFolderId, type: "Folder" };
  throw new Error("Provide exactly one of matter_id (create/list at a matter's document root) or parent_folder_id (create/list under an existing folder).");
}

/**
 * Finds a folder by exact name under a matter root or a parent folder.
 *
 * Paginates to completion and never filters on `parent.type`. Both of those
 * matter: a first-page-only read under-counts, and a matter whose document root
 * is itself a Folder node reports its children with parent.type "Folder", so a
 * parent-type filter excludes exactly the folders it was meant to find. Either
 * mistake turns "does this exist?" into a false negative, and a false negative
 * on a create path produces duplicate folders across the whole book.
 */
async function findFolderByName(parent: ParentRef, name: string): Promise<any | null> {
  const params: Record<string, string> = { fields: FOLDER_LIST_FIELDS, query: name, limit: "200" };
  if (parent.type === "Matter") params["matter_id"] = String(parent.id);
  else params["parent_id"] = String(parent.id);

  const allFolders = await clioGetAllPages("/folders.json", params);
  // Clio's `query` is a substring match, so confirm the exact name client-side.
  return allFolders.find((f: any) => f.name === name) ?? null;
}

export function registerFolderTools(server: McpServer): void {
  server.registerTool(
    "list_folders",
    {
      description: "List folders in Clio, filtered by matter or parent folder",
      inputSchema: {
        matter_id: z.number().int().positive().optional().describe("List folders at this matter's document root"),
        parent_id: z.number().int().positive().optional().describe("List folders under this parent folder ID"),
        query: z.string().optional().describe("Full-text search string for folder names"),
        limit: z.number().int().min(1).max(200).default(25).describe("Max results to return (1-200)"),
        page_token: z.string().optional().describe("Cursor from a previous list_folders response to fetch the next page"),
      },
    },
    async ({ matter_id, parent_id, query, limit, page_token }) => {
      if (!matter_id && !parent_id && !query) {
        return {
          content: [{ type: "text", text: "Error: provide at least one of matter_id, parent_id, or query" }],
          isError: true,
        };
      }

      try {
        const params: Record<string, string> = { fields: FOLDER_LIST_FIELDS, limit: String(limit) };
        if (matter_id) params["matter_id"] = String(matter_id);
        if (parent_id) params["parent_id"] = String(parent_id);
        if (query) params["query"] = query;
        if (page_token) params["page_token"] = page_token;

        const data = await clioGet("/folders.json", params);
        const folders = data.data as any[];
        const nextPageToken = folders.length >= limit ? extractNextPageToken(data.meta) : null;

        await appendAuditLog({
          tool: "list_folders",
          args: { matter_id, parent_id, limit, page_token },
          outcome: "success",
          result_count: folders?.length ?? 0,
          ...(matter_id && { matter_id }),
        });

        const result = {
          folders: folders.map((f) => ({
            id: f.id,
            name: f.name,
            parent: f.parent ? { id: f.parent.id, type: f.parent.type } : null,
            created_at: f.created_at,
            matter: f.matter ? { id: f.matter.id, display_number: f.matter.display_number } : null,
          })),
          total_count: data.meta?.records ?? folders.length,
          has_more: nextPageToken !== null,
          next_page_token: nextPageToken,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "list_folders",
          args: { matter_id, parent_id, limit, page_token },
          outcome: "error",
          error_message: err.message,
          ...(matter_id && { matter_id }),
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "folder_exists",
    {
      description:
        "Check whether a folder with the given exact name already exists under a matter's document root or under a parent folder. Fully paginates and never relies on parent-type filtering, so it won't false-negative on matters whose document root is itself a Folder node.",
      inputSchema: {
        matter_id: z.number().int().positive().optional().describe("Check under this matter's document root"),
        parent_folder_id: z.number().int().positive().optional().describe("Check under this existing folder"),
        name: z.string().min(1).describe("Exact folder name to check for"),
      },
    },
    async ({ matter_id, parent_folder_id, name }) => {
      try {
        const parent = resolveParentRef(matter_id, parent_folder_id);
        const match = await findFolderByName(parent, name);

        await appendAuditLog({
          tool: "folder_exists",
          args: { matter_id, parent_folder_id },
          outcome: "success",
          result_count: match ? 1 : 0,
          ...(matter_id && { matter_id }),
        });

        const result = {
          exists: match !== null,
          folder: match
            ? { id: match.id, name: match.name, parent: match.parent ? { id: match.parent.id, type: match.parent.type } : null }
            : null,
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "folder_exists",
          args: { matter_id, parent_folder_id },
          outcome: "error",
          error_message: err.message,
          ...(matter_id && { matter_id }),
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "create_folder",
    {
      description:
        "Create a folder in Clio under a matter's document root or under an existing folder. Set if_not_exists for bulk work: the check then happens inside this call, so a repeated run cannot create duplicates.",
      inputSchema: {
        name: z.string().min(1).describe("Folder name"),
        matter_id: z.number().int().positive().optional().describe("Create at this matter's document root"),
        parent_folder_id: z.number().int().positive().optional().describe("Create under this existing folder"),
        if_not_exists: z
          .boolean()
          .default(false)
          .describe("Return the existing folder instead of creating a second one when the name is already taken"),
      },
    },
    async ({ name, matter_id, parent_folder_id, if_not_exists }) => {
      try {
        const parent = resolveParentRef(matter_id, parent_folder_id);

        // Checking inside the tool rather than telling the caller to check first:
        // over several hundred matters the caller eventually skips the check, and
        // the cost of that is duplicate folders across the whole book.
        if (if_not_exists) {
          const existing = await findFolderByName(parent, name);
          if (existing) {
            await appendAuditLog({
              tool: "create_folder",
              args: { matter_id, parent_folder_id, if_not_exists },
              outcome: "success",
              result_count: 0,
              ...(matter_id && { matter_id }),
            });
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: true,
                  created: false,
                  folder: {
                    id: existing.id,
                    name: existing.name,
                    parent: existing.parent ? { id: existing.parent.id, type: existing.parent.type } : null,
                  },
                }, null, 2),
              }],
            };
          }
        }

        const data = await clioPost("/folders.json?fields=" + FOLDER_LIST_FIELDS, {
          data: { name, parent },
        });
        const folder = data.data;

        await appendAuditLog({
          tool: "create_folder",
          args: { matter_id, parent_folder_id, if_not_exists },
          outcome: "success",
          result_count: 1,
          ...(matter_id && { matter_id }),
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              created: true,
              folder: {
                id: folder.id,
                name: folder.name,
                parent: folder.parent ? { id: folder.parent.id, type: folder.parent.type } : null,
              },
            }, null, 2),
          }],
        };
      } catch (err: any) {
        const auditArgs = { matter_id, parent_folder_id, if_not_exists };
        if (err instanceof ClioApiError && err.statusCode === 422) {
          await appendAuditLog({ tool: "create_folder", args: auditArgs, outcome: "error", error_message: err.message, ...(matter_id && { matter_id }) });
          return { content: [{ type: "text", text: `Validation error: ${err.message}` }], isError: true };
        }
        await appendAuditLog({ tool: "create_folder", args: auditArgs, outcome: "error", error_message: err.message, ...(matter_id && { matter_id }) });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
