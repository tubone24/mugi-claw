import type { Browser, Page } from "puppeteer-core";

export interface CalendarEvent {
  summary: string;
  startTime: string;
  endTime: string;
  date: string;
  location?: string;
  isAllDay: boolean;
}

/**
 * 指定日のイベントを DOM スクレイピングで取得（日ビュー）
 */
async function scrapeDay(page: Page, dateStr: string): Promise<CalendarEvent[]> {
  const url = `https://calendar.google.com/calendar/r/day/${dateStr.replace(/-/g, "/")}`;
  console.error(`  ${dateStr} を取得中...`);

  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  // SPA のレンダリング待ち
  await new Promise((r) => setTimeout(r, 2000));

  const events = await page.evaluate((targetDate: string) => {
    const results: Array<{
      summary: string;
      startTime: string;
      endTime: string;
      date: string;
      location?: string;
      isAllDay: boolean;
    }> = [];

    const chips = document.querySelectorAll("[data-eventchip]");
    for (const chip of chips) {
      const text = (chip as HTMLElement).innerText?.trim() ?? "";
      const ariaLabel = chip.getAttribute("aria-label") ?? "";

      // 勤務場所チップは除外
      if (ariaLabel.includes("勤務場所") || text === "場所を追加") continue;

      // テキストから時刻とタイトルをパース
      // 形式: "HH:MM～HH:MM、「タイトル」、..."
      const timeMatch = text.match(/(\d{1,2}:\d{2})～(\d{1,2}:\d{2})、「(.+?)」/);
      if (timeMatch) {
        const [, startTime, endTime, summary] = timeMatch;

        // 場所を抽出
        const locMatch = text.match(/場所:\s*(.+?)、/);
        const location = locMatch?.[1]?.trim();

        results.push({
          summary,
          startTime,
          endTime,
          date: targetDate,
          location: location === "指定なし" ? undefined : location,
          isAllDay: false,
        });
      } else if (!text.match(/\d{1,2}:\d{2}/)) {
        // 時刻なし = 終日イベントの可能性
        const title = text.split("\n")[0]?.trim();
        if (title && title.length > 0) {
          results.push({
            summary: title,
            startTime: "",
            endTime: "",
            date: targetDate,
            isAllDay: true,
          });
        }
      }
    }

    return results;
  }, dateStr);

  return events;
}

/**
 * 日付範囲のイベントを取得
 */
export async function fetchCalendarEvents(
  browser: Browser,
  startDate: string,
  endDate: string
): Promise<CalendarEvent[]> {
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  const allEvents: CalendarEvent[] = [];

  // 日付範囲を生成
  const dates = getDateRange(startDate, endDate);
  console.error(`${dates.length} 日分のイベントを取得します (${startDate} ～ ${endDate})`);

  for (const dateStr of dates) {
    const dayEvents = await scrapeDay(page, dateStr);
    allEvents.push(...dayEvents);
  }

  console.error(`合計 ${allEvents.length} 件のイベントを取得しました`);
  return allEvents;
}

function getDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const current = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);

  while (current <= last) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, "0");
    const d = String(current.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}
