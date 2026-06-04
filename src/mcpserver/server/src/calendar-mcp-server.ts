import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getAuthContext, getDelegatedGraphClient } from "./auth.js";

type GraphAttendee = {
  emailAddress: { address: string; name?: string };
  type?: "required" | "optional" | "resource";
};

function buildAttendees(emails: string[] | undefined): GraphAttendee[] | undefined {
  if (!emails?.length) return undefined;
  return emails.map((address) => ({ emailAddress: { address }, type: "required" }));
}

function formatEventSummary(e: any): string {
  const start = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleString() : "?";
  const end = e.end?.dateTime ? new Date(e.end.dateTime).toLocaleString() : "?";
  return `• ${e.subject ?? "(no subject)"} — ${start} → ${end}`;
}

function toTextResult(text: string, structured?: unknown): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured as any } : {}),
  };
}

export function createCalendarMcpServer(): McpServer {
  const server = new McpServer({
    name: "probation-calendar-mcp",
    version: "1.0.0",
  });

  // ── ListEvents ─────────────────────────────────────────────────────────────
  server.tool(
    "ListEvents",
    "Retrieve a list of calendar events for the signed-in user. Use when the user asks about their schedule, upcoming meetings, or events on a specific date. Returns the master event for recurring meetings (use ListCalendarView for expanded recurring instances).",
    {
      startDateTime: z.string().optional().describe("ISO 8601 start datetime, e.g. 2026-06-04T00:00:00+02:00. Defaults to now."),
      endDateTime: z.string().optional().describe("ISO 8601 end datetime. Defaults to 7 days from start."),
      top: z.number().int().optional().describe("Max events to return. Default 25."),
      search: z.string().optional().describe("Search text to filter events by subject/body."),
    },
    async ({ startDateTime, endDateTime, top, search }): Promise<CallToolResult> => {
      const graph = getDelegatedGraphClient();
      const start = startDateTime ?? new Date().toISOString();
      const end = endDateTime ?? new Date(Date.parse(start) + 7 * 24 * 3600 * 1000).toISOString();
      const limit = top ?? 25;
      let req = graph
        .api("/me/events")
        .filter(`start/dateTime ge '${start}' and end/dateTime le '${end}'`)
        .top(limit)
        .orderby("start/dateTime")
        .select("id,subject,start,end,location,attendees,organizer,isOnlineMeeting,onlineMeeting,bodyPreview,webLink");
      if (search) req = req.search(`"${search.replace(/"/g, '\\"')}"`);
      const resp = await req.get();
      const events: any[] = resp.value ?? [];
      const summary = events.length
        ? `Found ${events.length} event(s) between ${start} and ${end}:\n${events.map(formatEventSummary).join("\n")}`
        : `No events between ${start} and ${end}.`;
      return toTextResult(summary, { events, window: { start, end } });
    },
  );

  // ── ListCalendarView (expands recurring) ──────────────────────────────────
  server.tool(
    "ListCalendarView",
    "Retrieve calendar events in a window with recurring meetings EXPANDED into individual instances. Prefer this over ListEvents for day/week views.",
    {
      startDateTime: z.string().describe("ISO 8601 start of window (REQUIRED)."),
      endDateTime: z.string().describe("ISO 8601 end of window (REQUIRED)."),
      top: z.number().int().optional().describe("Max events to return. Default 50."),
    },
    async ({ startDateTime, endDateTime, top }): Promise<CallToolResult> => {
      const graph = getDelegatedGraphClient();
      const resp = await graph
        .api("/me/calendarView")
        .query({ startDateTime, endDateTime })
        .top(top ?? 50)
        .orderby("start/dateTime")
        .select("id,subject,start,end,location,attendees,organizer,isOnlineMeeting,onlineMeeting,bodyPreview,webLink,seriesMasterId")
        .get();
      const events: any[] = resp.value ?? [];
      const summary = events.length
        ? `Calendar view ${startDateTime} → ${endDateTime} (${events.length} event(s)):\n${events.map(formatEventSummary).join("\n")}`
        : `No events in ${startDateTime} → ${endDateTime}.`;
      return toTextResult(summary, { events, window: { start: startDateTime, end: endDateTime } });
    },
  );

  // ── FindMeetingTimes ──────────────────────────────────────────────────────
  server.tool(
    "FindMeetingTimes",
    "Suggest free meeting slots for the signed-in user and a list of attendees based on free/busy availability.",
    {
      attendees: z.array(z.string()).describe("Email addresses of attendees (required)."),
      meetingDuration: z.string().optional().describe("ISO 8601 duration, e.g. PT30M, PT1H. Default PT30M."),
      windowStart: z.string().optional().describe("ISO 8601 earliest acceptable start (used if timeConstraint is not provided). Defaults to now."),
      windowEnd: z.string().optional().describe("ISO 8601 latest acceptable end (used if timeConstraint is not provided). Defaults to 7 days out."),
      timeConstraint: z
        .object({
          activityDomain: z.string().optional(),
          timeSlots: z
            .array(
              z.object({
                start: z.object({ dateTime: z.string(), timeZone: z.string() }),
                end: z.object({ dateTime: z.string(), timeZone: z.string() }),
              }),
            )
            .optional(),
        })
        .passthrough()
        .optional()
        .describe("Optional full Graph timeConstraint with timeSlots. Takes precedence over windowStart/windowEnd."),
      maxCandidates: z.number().int().optional().describe("Max suggestions. Default 5."),
    },
    async ({ attendees, meetingDuration, windowStart, windowEnd, timeConstraint, maxCandidates }): Promise<CallToolResult> => {
      const graph = getDelegatedGraphClient();

      // LLMs sometimes lowercase the keys (e.g. "timeslots" instead of "timeSlots"). Normalize.
      const normalizeSlot = (s: any) => {
        const startObj = s?.start ?? s?.Start;
        const endObj = s?.end ?? s?.End;
        if (!startObj || !endObj) return null;
        return {
          start: { dateTime: startObj.dateTime ?? startObj.datetime ?? startObj.DateTime, timeZone: startObj.timeZone ?? startObj.timezone ?? startObj.TimeZone ?? "UTC" },
          end: { dateTime: endObj.dateTime ?? endObj.datetime ?? endObj.DateTime, timeZone: endObj.timeZone ?? endObj.timezone ?? endObj.TimeZone ?? "UTC" },
        };
      };
      const rawTimeSlots = (timeConstraint as any)?.timeSlots ?? (timeConstraint as any)?.timeslots ?? (timeConstraint as any)?.TimeSlots;
      const normalizedSlots = Array.isArray(rawTimeSlots) ? rawTimeSlots.map(normalizeSlot).filter(Boolean) : [];

      let effectiveConstraint: any;
      if (normalizedSlots.length) {
        effectiveConstraint = { activityDomain: timeConstraint?.activityDomain ?? "work", timeSlots: normalizedSlots };
      } else {
        const start = windowStart ?? new Date().toISOString();
        const end = windowEnd ?? new Date(Date.parse(start) + 7 * 24 * 3600 * 1000).toISOString();
        effectiveConstraint = {
          activityDomain: "work",
          timeSlots: [{ start: { dateTime: start, timeZone: "UTC" }, end: { dateTime: end, timeZone: "UTC" } }],
        };
      }
      const resp = await graph.api("/me/findMeetingTimes").post({
        attendees: attendees.map((a) => ({ emailAddress: { address: a }, type: "required" })),
        timeConstraint: effectiveConstraint,
        meetingDuration: meetingDuration ?? "PT30M",
        maxCandidates: maxCandidates ?? 5,
        minimumAttendeePercentage: 1,
      });
      const suggestions = (resp.meetingTimeSuggestions ?? []) as any[];
      const windowDesc = effectiveConstraint.timeSlots
        .map((s: any) => `${s.start.dateTime} ${s.start.timeZone} → ${s.end.dateTime} ${s.end.timeZone}`)
        .join("; ");
      const summary = suggestions.length
        ? `Found ${suggestions.length} suggested slot(s):\n` +
          suggestions
            .map((s) => `• ${s.meetingTimeSlot?.start?.dateTime} ${s.meetingTimeSlot?.start?.timeZone} → ${s.meetingTimeSlot?.end?.dateTime} ${s.meetingTimeSlot?.end?.timeZone} (confidence ${s.confidence})`)
            .join("\n")
        : `No suitable slots found for ${attendees.join(", ")} in window: ${windowDesc}. Reason: ${resp.emptySuggestionsReason ?? "(none provided by Graph)"}. Try a wider time window or different attendees.`;
      return toTextResult(summary, { suggestions, attendees, timeConstraint: effectiveConstraint, emptySuggestionsReason: resp.emptySuggestionsReason });
    },
  );

  // ── CreateEvent ───────────────────────────────────────────────────────────
  server.tool(
    "CreateEvent",
    "Create a new calendar event in the signed-in user's Outlook calendar. Supports attendees, Teams online meeting, location.",
    {
      subject: z.string().describe("Event title (required)."),
      start: z.string().describe("ISO 8601 start datetime with timezone offset (required)."),
      end: z.string().describe("ISO 8601 end datetime with timezone offset (required)."),
      attendees: z.array(z.string()).optional().describe("Email addresses of attendees."),
      location: z.string().optional().describe("Location display name."),
      body: z.string().optional().describe("HTML or plain body for the event description."),
      isOnlineMeeting: z.boolean().optional().describe("Set true to create a Teams meeting. Default false."),
    },
    async ({ subject, start, end, attendees, location, body, isOnlineMeeting }): Promise<CallToolResult> => {
      const graph = getDelegatedGraphClient();
      const payload: Record<string, unknown> = {
        subject,
        start: { dateTime: start, timeZone: "UTC" },
        end: { dateTime: end, timeZone: "UTC" },
      };
      const a = buildAttendees(attendees);
      if (a) payload.attendees = a;
      if (location) payload.location = { displayName: location };
      if (body) payload.body = { contentType: "HTML", content: body };
      if (isOnlineMeeting) {
        payload.isOnlineMeeting = true;
        payload.onlineMeetingProvider = "teamsForBusiness";
      }
      const event = await graph.api("/me/events").post(payload);
      return toTextResult(
        `Created event "${event.subject}" (id ${event.id}) from ${start} to ${end}.${event.onlineMeeting?.joinUrl ? ` Teams join URL: ${event.onlineMeeting.joinUrl}` : ""}`,
        { event },
      );
    },
  );

  // ── UpdateEvent ───────────────────────────────────────────────────────────
  server.tool(
    "UpdateEvent",
    "Update an existing calendar event. Provide eventId and only the fields to change.",
    {
      eventId: z.string().describe("Event ID (required)."),
      subject: z.string().optional(),
      start: z.string().optional().describe("ISO 8601 datetime."),
      end: z.string().optional().describe("ISO 8601 datetime."),
      attendees: z.array(z.string()).optional(),
      location: z.string().optional(),
      body: z.string().optional(),
    },
    async ({ eventId, subject, start, end, attendees, location, body }): Promise<CallToolResult> => {
      const graph = getDelegatedGraphClient();
      const payload: Record<string, unknown> = {};
      if (subject) payload.subject = subject;
      if (start) payload.start = { dateTime: start, timeZone: "UTC" };
      if (end) payload.end = { dateTime: end, timeZone: "UTC" };
      const a = buildAttendees(attendees);
      if (a) payload.attendees = a;
      if (location) payload.location = { displayName: location };
      if (body) payload.body = { contentType: "HTML", content: body };
      const event = await graph.api(`/me/events/${eventId}`).patch(payload);
      return toTextResult(`Updated event ${eventId}.`, { event });
    },
  );

  // ── DeleteEventById ───────────────────────────────────────────────────────
  server.tool(
    "DeleteEventById",
    "Delete a calendar event by ID. Use when the organizer wants to remove an event without notifying attendees.",
    {
      eventId: z.string().describe("Event ID (required)."),
    },
    async ({ eventId }): Promise<CallToolResult> => {
      const graph = getDelegatedGraphClient();
      await graph.api(`/me/events/${eventId}`).delete();
      return toTextResult(`Deleted event ${eventId}.`);
    },
  );

  // ── CancelEvent (notifies attendees) ──────────────────────────────────────
  server.tool(
    "CancelEvent",
    "Cancel a calendar event as the organizer and notify all attendees.",
    {
      eventId: z.string().describe("Event ID (required)."),
      comment: z.string().optional().describe("Cancellation message to include."),
    },
    async ({ eventId, comment }): Promise<CallToolResult> => {
      const graph = getDelegatedGraphClient();
      await graph.api(`/me/events/${eventId}/cancel`).post({ Comment: comment ?? "" });
      return toTextResult(`Cancelled event ${eventId}${comment ? ` with note: ${comment}` : ""}.`);
    },
  );

  // ── AcceptEvent / TentativelyAcceptEvent / DeclineEvent ───────────────────
  const responseTool = (
    name: "AcceptEvent" | "TentativelyAcceptEvent" | "DeclineEvent",
    desc: string,
    action: "accept" | "tentativelyAccept" | "decline",
  ) => {
    server.tool(
      name,
      desc,
      {
        eventId: z.string().describe("Event ID (required)."),
        comment: z.string().optional(),
        sendResponse: z.boolean().optional().describe("Whether to send a response. Default true."),
      },
      async ({ eventId, comment, sendResponse }): Promise<CallToolResult> => {
        const graph = getDelegatedGraphClient();
        await graph.api(`/me/events/${eventId}/${action}`).post({
          Comment: comment ?? "",
          SendResponse: sendResponse ?? true,
        });
        return toTextResult(`${action} sent for event ${eventId}.`);
      },
    );
  };
  responseTool("AcceptEvent", "Accept a calendar event invitation.", "accept");
  responseTool("TentativelyAcceptEvent", "Tentatively accept a calendar event invitation.", "tentativelyAccept");
  responseTool("DeclineEvent", "Decline a calendar event invitation.", "decline");

  // ── WhoAmI (handy debugging tool) ─────────────────────────────────────────
  server.tool(
    "WhoAmI",
    "Returns the signed-in user's display name, UPN, and timezone. Useful for debugging that the OBO + Graph chain works.",
    {},
    async (): Promise<CallToolResult> => {
      const graph = getDelegatedGraphClient();
      const me = await graph.api("/me").select("id,displayName,userPrincipalName,mail,mailboxSettings").get();
      const ctx = getAuthContext();
      return toTextResult(
        `Signed in as ${me.displayName} (${me.userPrincipalName ?? ctx.userPrincipalName}). Tenant ${ctx.tenantId}.`,
        { me, authContext: { userId: ctx.userId, userPrincipalName: ctx.userPrincipalName, tenantId: ctx.tenantId } },
      );
    },
  );

  return server;
}
