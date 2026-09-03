import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGetAllPages } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

/**
 * One call that answers "which matters have gone quiet?" across the whole open
 * book.
 *
 * The naive shape of this is a loop: for each open matter, fetch its notes, its
 * time entries, its calendar entries, its tasks. On a few hundred matters that
 * is over a thousand requests, it takes minutes, and it walks straight into
 * Clio's rate limiter. So this fetches each collection ONCE, account-wide and
 * bounded by date, then groups by matter id in memory. Cost is roughly a
 * handful of paginated reads regardless of how many matters the firm has.
 *
 * The output is deliberately dates and counts only, never note bodies or time
 * entry narratives: it is a triage pass meant to decide which matters deserve a
 * closer look, and keeping it thin is what makes it cheap to run over the whole
 * book on a schedule.
 */

const SUMMARY_MATTER_FIELDS = "id,display_number,description,status,client{id,name}";
const SUMMARY_NOTE_FIELDS = "id,date,created_at,matter{id}";
const SUMMARY_ACTIVITY_FIELDS = "id,date,matter{id}";
const SUMMARY_CALENDAR_FIELDS = "id,summary,start_at,matter{id}";
const SUMMARY_TASK_FIELDS = "id,due_at,status,matter{id}";

/** Newest of a set of date-ish strings, ignoring blanks and unparseable values. */
function latest(dates: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const d of dates) {
    if (!d) continue;
    const ms = Date.parse(d);
    if (Number.isNaN(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = d;
    }
  }
  return best;
}

function daysBetween(fromIso: string | null, now: number): number | null {
  if (!fromIso) return null;
  const ms = Date.parse(fromIso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((now - ms) / 86_400_000));
}

/** Groups records by their `matter.id`, dropping any that are not matter-linked. */
function groupByMatter(records: any[]): Map<number, any[]> {
  const out = new Map<number, any[]>();
  for (const r of records) {
    const id = r?.matter?.id;
    if (typeof id !== "number") continue;
    const bucket = out.get(id);
    if (bucket) bucket.push(r);
    else out.set(id, [r]);
  }
  return out;
}

function isoDaysAgo(days: number, now: number): string {
  return new Date(now - days * 86_400_000).toISOString();
}

export function registerActivitySummaryTools(server: McpServer): void {
  server.registerTool(
    "matter_activity_summary",
    {
      description:
        "Activity snapshot for every open matter in one call: last note, last time entry, next calendar entry, open task count, and days since anything happened. Sorted by staleness, so matters with no recent file activity come first. Use this as the cheap first pass of a case-monitoring sweep, then look closely only at what it flags.",
      inputSchema: {
        lookback_days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(90)
          .describe(
            "How far back to look for notes and time entries. A matter with nothing in this window reports null " +
              "and counts as maximally stale. Staleness is measured by a note's own event date, not when it was " +
              "imported into Clio, so a note created inside the window but dated years earlier can still push " +
              "days_since_last_activity well past lookback_days - that is the event date doing its job, not a bug. " +
              "Capped at 365: on large books (thousands of notes/time entries) longer lookbacks risk the tool " +
              "call exceeding a client's timeout."
          ),
        calendar_days_ahead: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(90)
          .describe("How far forward to look for the next calendar entry"),
        practice_area_id: z.number().int().positive().optional().describe("Limit to matters in one practice area"),
        stale_after_days: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Only return matters with no activity for at least this many days"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(100)
          .describe("Max matters to return, taken from the stalest end"),
      },
    },
    async ({ lookback_days, calendar_days_ahead, practice_area_id, stale_after_days, limit }) => {
      const auditArgs = { lookback_days, calendar_days_ahead, practice_area_id, stale_after_days, limit };
      try {
        const now = Date.now();
        const since = isoDaysAgo(lookback_days, now);
        const sinceDate = since.slice(0, 10);
        const todayDate = new Date(now).toISOString().slice(0, 10);
        const aheadDate = new Date(now + calendar_days_ahead * 86_400_000).toISOString().slice(0, 10);

        const matterParams: Record<string, string> = {
          fields: SUMMARY_MATTER_FIELDS,
          status: "open",
          limit: "200",
        };
        if (practice_area_id) matterParams["practice_area_id"] = String(practice_area_id);

        // Five account-wide reads, not five per matter.
        const [matters, notes, activities, calendarEntries, tasks] = await Promise.all([
          clioGetAllPages("/matters.json", matterParams),
          clioGetAllPages("/notes.json", {
            fields: SUMMARY_NOTE_FIELDS,
            type: "matter",
            created_since: since,
            limit: "200",
          }),
          clioGetAllPages("/activities.json", {
            fields: SUMMARY_ACTIVITY_FIELDS,
            start_date: sinceDate,
            limit: "200",
          }),
          clioGetAllPages("/calendar_entries.json", {
            fields: SUMMARY_CALENDAR_FIELDS,
            from: `${todayDate}T00:00:00Z`,
            to: `${aheadDate}T23:59:59Z`,
            limit: "200",
          }),
          clioGetAllPages("/tasks.json", {
            fields: SUMMARY_TASK_FIELDS,
            status: "pending",
            limit: "200",
          }),
        ]);

        const notesByMatter = groupByMatter(notes);
        const activitiesByMatter = groupByMatter(activities);
        const calendarByMatter = groupByMatter(calendarEntries);
        const tasksByMatter = groupByMatter(tasks);

        const rows = matters.map((m: any) => {
          const lastNote = latest((notesByMatter.get(m.id) ?? []).map((n) => n.date ?? n.created_at));
          const lastTimeEntry = latest((activitiesByMatter.get(m.id) ?? []).map((a) => a.date));

          const upcoming = (calendarByMatter.get(m.id) ?? [])
            .filter((c) => c.start_at && Date.parse(c.start_at) >= now)
            .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
          const nextEntry = upcoming[0] ?? null;

          const lastActivity = latest([lastNote, lastTimeEntry]);

          return {
            matter_id: m.id,
            display_number: m.display_number,
            description: m.description,
            client: m.client?.name ?? null,
            last_note_date: lastNote,
            last_time_entry_date: lastTimeEntry,
            next_calendar_entry: nextEntry
              ? { start_at: nextEntry.start_at, summary: nextEntry.summary ?? null }
              : null,
            open_tasks_count: (tasksByMatter.get(m.id) ?? []).length,
            // null means nothing at all inside the lookback window, which is a
            // stronger signal than any number this can return. Sorting treats it
            // as the stalest possible value for exactly that reason.
            days_since_last_activity: daysBetween(lastActivity, now),
          };
        });

        rows.sort((a, b) => {
          const av = a.days_since_last_activity ?? Number.POSITIVE_INFINITY;
          const bv = b.days_since_last_activity ?? Number.POSITIVE_INFINITY;
          return bv - av;
        });

        const filtered =
          stale_after_days === undefined
            ? rows
            : rows.filter(
                (r) =>
                  r.days_since_last_activity === null || r.days_since_last_activity >= stale_after_days
              );

        const page = filtered.slice(0, limit);

        await appendAuditLog({
          tool: "matter_activity_summary",
          args: auditArgs,
          outcome: "success",
          result_count: page.length,
        });

        const result = {
          matters: page,
          open_matters_scanned: matters.length,
          matched: filtered.length,
          returned: page.length,
          window: {
            activity_since: since,
            calendar_from: todayDate,
            calendar_to: aheadDate,
          },
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        await appendAuditLog({
          tool: "matter_activity_summary",
          args: auditArgs,
          outcome: "error",
          error_message: err.message,
        });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
