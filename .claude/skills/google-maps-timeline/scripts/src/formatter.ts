import type { WorkVisit } from "./timeline-analyzer.js";

export type OutputFormat = "table" | "json";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function getWeekday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00+09:00");
  return WEEKDAYS[d.getDay()];
}

export function formatAttendance(
  byDate: Map<string, WorkVisit[]>,
  month: string,
  format: OutputFormat
): string {
  const dates = Array.from(byDate.keys()).sort();

  if (format === "json") {
    const result = dates.map((date) => {
      const visits = byDate.get(date)!;
      return {
        date,
        weekday: getWeekday(date),
        visitCount: visits.length,
        totalMinutes: visits.reduce((s, v) => s + v.duration, 0),
        visits: visits.map((v) => ({
          startTime: v.startTime,
          endTime: v.endTime,
          duration: v.duration,
        })),
      };
    });
    return JSON.stringify(result, null, 2);
  }

  // table形式
  if (dates.length === 0) {
    return `${month} の職場訪問は検出されませんでした。\n\n座標指定する場合は --lat / --lng / --radius オプションを使用してください。`;
  }

  const lines: string[] = [];
  lines.push(`${month} 出社日一覧（${dates.length}日）`);
  lines.push("═".repeat(44));
  lines.push("  日付          曜日  最初の到着  最後の退出  合計滞在");
  lines.push("─".repeat(44));

  for (const date of dates) {
    const visits = byDate.get(date)!;
    const firstArrival = visits[0].startTime;
    const lastDeparture = visits[visits.length - 1].endTime;
    const totalMin = visits.reduce((s, v) => s + v.duration, 0);
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    const totalStr = `${String(hours).padStart(2)}h${String(mins).padStart(2, "0")}m`;
    const weekday = getWeekday(date);

    lines.push(
      `  ${date}  (${weekday})  ${firstArrival}      ${lastDeparture}    ${totalStr}`
    );
  }

  lines.push("─".repeat(44));
  lines.push(`  合計: ${dates.length} 日`);

  return lines.join("\n");
}
