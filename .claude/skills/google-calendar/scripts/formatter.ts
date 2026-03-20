import type { CalendarEvent } from "./calendar-fetcher.js";

export type OutputFormat = "json" | "text";

export function formatEvents(
  events: CalendarEvent[],
  format: OutputFormat
): string {
  if (events.length === 0) {
    return format === "json" ? "[]" : "予定はありません。";
  }

  if (format === "json") {
    return JSON.stringify(events, null, 2);
  }

  // 日付ごとにグループ化
  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const existing = byDate.get(event.date) ?? [];
    existing.push(event);
    byDate.set(event.date, existing);
  }

  const lines: string[] = [];

  for (const [date, dayEvents] of byDate) {
    const weekday = getWeekdayJa(date);
    lines.push(`## ${date} (${weekday})`);

    // 終日 → 時刻順
    const sorted = [...dayEvents].sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.startTime.localeCompare(b.startTime);
    });

    for (const event of sorted) {
      const time = event.isAllDay
        ? "[終日]       "
        : `${event.startTime} - ${event.endTime}`;
      let line = `  ${time}  ${event.summary}`;
      if (event.location) {
        line += `  (${event.location})`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function getWeekdayJa(dateStr: string): string {
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const date = new Date(dateStr + "T00:00:00");
  return days[date.getDay()];
}
