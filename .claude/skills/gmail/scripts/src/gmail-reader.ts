import type { Page } from "puppeteer-core";

export interface GmailThreadMessage {
  from: string;
  to: string;
  date: string;
  body: string;
}

export interface GmailThread {
  subject: string;
  messages: GmailThreadMessage[];
}

/**
 * スレッド全体を開いて本文を読み取る
 */
export async function readThread(
  page: Page,
  threadId: string
): Promise<GmailThread> {
  const url = `https://mail.google.com/mail/u/0/#all/${threadId}`;
  console.error(`スレッドを開いています: ${url}`);

  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

  // メール本文が表示されるまで待機
  await page
    .waitForSelector('div[role="list"]', { timeout: 15000 })
    .catch(() => {
      console.error("スレッドビューのセレクタが見つかりません。");
    });

  await new Promise((r) => setTimeout(r, 2000));

  // 「すべて展開」ボタンをクリック（折りたたまれたメッセージがある場合）
  await page.evaluate(() => {
    // 折りたたまれたメッセージの展開ボタン
    const expandBtns = document.querySelectorAll(
      'div[role="button"][aria-label*="展開"], span.adx, div.kv, div[aria-expanded="false"]'
    );
    for (const btn of expandBtns) {
      (btn as HTMLElement).click();
    }

    // "N 件のメッセージ" のような折りたたみを展開
    const collapsedIndicator = document.querySelector("span.e0");
    if (collapsedIndicator) {
      (collapsedIndicator as HTMLElement).click();
    }
  });

  // 展開後の待機
  await new Promise((r) => setTimeout(r, 2000));

  const thread = await page.evaluate(() => {
    // 件名取得
    const subjectEl =
      document.querySelector("h2.hP") ??
      document.querySelector('div[data-thread-perm-id] h2') ??
      document.querySelector("h2");
    const subject = (subjectEl as HTMLElement)?.innerText?.trim() ?? "";

    // 各メッセージを取得
    const messageEls = document.querySelectorAll(
      'div[role="listitem"], div.gs, div[data-message-id]'
    );
    const messages: Array<{
      from: string;
      to: string;
      date: string;
      body: string;
    }> = [];

    for (const msgEl of messageEls) {
      const htmlMsg = msgEl as HTMLElement;

      // 差出人
      const fromEl =
        htmlMsg.querySelector("span.gD") ??
        htmlMsg.querySelector("span[email]") ??
        htmlMsg.querySelector('span.go');
      const from =
        fromEl?.getAttribute("email") ??
        fromEl?.getAttribute("name") ??
        (fromEl as HTMLElement)?.innerText?.trim() ??
        "";

      // 宛先
      const toEl = htmlMsg.querySelector("span.g2");
      const to = (toEl as HTMLElement)?.innerText?.trim() ?? "";

      // 日時
      const dateEl =
        htmlMsg.querySelector("span.g3") ??
        htmlMsg.querySelector('span[alt]') ??
        htmlMsg.querySelector("span.gK");
      const date =
        dateEl?.getAttribute("title") ??
        dateEl?.getAttribute("alt") ??
        (dateEl as HTMLElement)?.innerText?.trim() ??
        "";

      // 本文
      const bodyEl =
        htmlMsg.querySelector("div.a3s.aiL") ??
        htmlMsg.querySelector("div.a3s") ??
        htmlMsg.querySelector('div[dir="ltr"]');
      const body = (bodyEl as HTMLElement)?.innerText?.trim() ?? "";

      if (from || body) {
        messages.push({ from, to, date, body });
      }
    }

    return { subject, messages };
  });

  if (thread.messages.length === 0) {
    // フォールバック: 単一メッセージとして取得
    const fallback = await page.evaluate(() => {
      const subject =
        (document.querySelector("h2.hP") as HTMLElement)?.innerText?.trim() ??
        "";
      const bodyEl =
        document.querySelector("div.a3s.aiL") ??
        document.querySelector("div.a3s") ??
        document.querySelector('div[dir="ltr"]');
      const body = (bodyEl as HTMLElement)?.innerText?.trim() ?? "";
      const fromEl = document.querySelector("span.gD");
      const from =
        fromEl?.getAttribute("email") ??
        (fromEl as HTMLElement)?.innerText?.trim() ??
        "";
      const dateEl = document.querySelector("span.g3");
      const date =
        dateEl?.getAttribute("title") ??
        (dateEl as HTMLElement)?.innerText?.trim() ??
        "";

      return {
        subject,
        messages: body ? [{ from, to: "", date, body }] : [],
      };
    });
    return fallback;
  }

  return thread;
}
