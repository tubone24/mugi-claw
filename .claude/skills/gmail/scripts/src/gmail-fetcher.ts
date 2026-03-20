import type { Page } from "puppeteer-core";

export interface GmailMessage {
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
}

/**
 * 複数のセレクタパターンを試行して要素を取得
 */
async function querySelectorAllWithFallback(
  page: Page,
  selectors: string[]
): Promise<any[]> {
  for (const selector of selectors) {
    const elements = await page.$$(selector);
    if (elements.length > 0) return elements;
  }
  return [];
}

/**
 * メール一覧をDOMスクレイピングで取得
 */
export async function fetchMailList(
  page: Page,
  options: {
    label?: string;
    query?: string;
    limit: number;
  }
): Promise<GmailMessage[]> {
  // URL決定
  let url = "https://mail.google.com/mail/u/0/#inbox";
  if (options.query) {
    url = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(options.query)}`;
  } else if (options.label) {
    url = `https://mail.google.com/mail/u/0/#label/${encodeURIComponent(options.label)}`;
  }

  console.error(`Gmail を開いています: ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

  // メール行が表示されるまで待機
  await page.waitForSelector("tr.zA", { timeout: 15000 }).catch(() => {
    console.error("メール行セレクタ tr.zA が見つかりません。代替セレクタを試行します...");
  });

  // 追加のレンダリング待ち
  await new Promise((r) => setTimeout(r, 2000));

  const allMessages: GmailMessage[] = [];
  let pageCount = 0;
  const maxPages = Math.ceil(options.limit / 50); // Gmailは1ページ50件

  while (allMessages.length < options.limit && pageCount < maxPages) {
    pageCount++;

    const messages = await page.evaluate(() => {
      const results: Array<{
        threadId: string;
        from: string;
        subject: string;
        snippet: string;
        date: string;
        unread: boolean;
      }> = [];

      const rows = document.querySelectorAll("tr.zA");
      for (const row of rows) {
        const htmlRow = row as HTMLElement;

        // スレッドIDを data-legacy-thread-id または href から取得
        const threadId =
          htmlRow.getAttribute("data-legacy-thread-id") ??
          htmlRow.querySelector("a[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id") ??
          (() => {
            const link = htmlRow.querySelector("a[href*='#']");
            const href = link?.getAttribute("href") ?? "";
            const match = href.match(/#[^/]+\/(.+)$/);
            return match?.[1] ?? "";
          })();

        // 差出人: span.yW > span.zF or span.yP or span.bA4
        const fromEl =
          htmlRow.querySelector("span.zF") ??
          htmlRow.querySelector("span.yP") ??
          htmlRow.querySelector("span.bA4") ??
          htmlRow.querySelector("[email]");
        const from =
          fromEl?.getAttribute("name") ??
          fromEl?.getAttribute("email") ??
          (fromEl as HTMLElement)?.innerText?.trim() ??
          "";

        // 件名: span.bog > span.bqe or td.xY a span
        const subjectEl =
          htmlRow.querySelector("span.bqe") ??
          htmlRow.querySelector("td.xY a span") ??
          htmlRow.querySelector("span.y2");
        const subject = (subjectEl as HTMLElement)?.innerText?.trim() ?? "";

        // スニペット: span.y2
        const snippetEl = htmlRow.querySelector("span.y2");
        let snippet = (snippetEl as HTMLElement)?.innerText?.trim() ?? "";
        // スニペットから先頭の " - " を除去
        snippet = snippet.replace(/^\s*-\s*/, "");

        // 日時: td.xW > span[title] or span.bq3
        const dateEl =
          htmlRow.querySelector("td.xW span[title]") ??
          htmlRow.querySelector("span.bq3") ??
          htmlRow.querySelector("td.xW span");
        const date =
          dateEl?.getAttribute("title") ??
          (dateEl as HTMLElement)?.innerText?.trim() ??
          "";

        // 未読判定: tr.zE（未読）or tr.yO（既読）
        const unread = htmlRow.classList.contains("zE");

        if (subject || from) {
          results.push({ threadId, from, subject, snippet, date, unread });
        }
      }

      return results;
    });

    allMessages.push(...messages);

    if (allMessages.length >= options.limit) break;

    // 次ページボタンをクリック
    const hasNextPage = await page.evaluate(() => {
      // 次ページボタン: div[aria-label="新しいメール"] or div.T-I.J-J5-Ji[act="20"]
      const nextBtn =
        document.querySelector('div[aria-label="古いメール"]') ??
        document.querySelector('div.T-I.J-J5-Ji[act="20"]');
      if (nextBtn && !(nextBtn as HTMLElement).getAttribute("aria-disabled")) {
        (nextBtn as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (!hasNextPage) break;

    // ページ遷移待ち
    await new Promise((r) => setTimeout(r, 3000));
  }

  return allMessages.slice(0, options.limit);
}
