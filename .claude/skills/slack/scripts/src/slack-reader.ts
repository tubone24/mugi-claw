import type { Page } from "puppeteer-core";
import type { SlackMessage } from "./slack-fetcher.js";
import { getTeamId, waitForSlack } from "./slack-fetcher.js";

// ─── インターフェース ────────────────────────────────────────────
export interface SlackThread {
  parent: SlackMessage;
  replies: SlackMessage[];
}

// ─── readThread ──────────────────────────────────────────────────

/**
 * 指定チャンネル内の特定メッセージのスレッドを読み取る。
 */
export async function readThread(
  page: Page,
  channelNameOrId: string,
  ts: string
): Promise<SlackThread> {
  const teamId = await getTeamId(page);

  // チャンネルに遷移
  let channelId = channelNameOrId;
  if (/^[CD][A-Z0-9]+$/.test(channelNameOrId)) {
    // ID がそのまま渡された場合
    channelId = channelNameOrId;
  } else {
    // チャンネル名から ID を推定する
    channelId = await resolveChannelId(page, channelNameOrId);
  }

  // スレッドの URL は /client/{TEAM_ID}/{CHANNEL_ID}/thread/{CHANNEL_ID}-{TS}
  // ts は "1234567890.123456" 形式。URL では "p1234567890123456" 形式になることもある
  const threadUrl = `https://app.slack.com/client/${teamId}/${channelId}/thread/${channelId}-${ts}`;
  console.error(`スレッドに遷移します: ${threadUrl}`);
  await page.goto(threadUrl, { waitUntil: "networkidle2", timeout: 30_000 });

  // スレッドパネルが表示されるまで待機
  await waitForThreadPanel(page);

  // スレッドからメッセージを抽出
  const thread = await extractThread(page);

  if (!thread.parent.ts && !thread.parent.text) {
    // URL 直遷移で失敗した場合のフォールバック: チャンネルを開いてメッセージを探す
    console.error(
      "URL 直遷移でスレッドが開けませんでした。チャンネルに遷移してメッセージを探します..."
    );
    return await openThreadFromChannel(page, teamId, channelId, ts);
  }

  console.error(
    `スレッド: 親メッセージ + ${thread.replies.length} 件の返信`
  );
  return thread;
}

/**
 * チャンネル名からチャンネル ID を解決する。
 */
async function resolveChannelId(
  page: Page,
  channelName: string
): Promise<string> {
  await waitForSlack(page);

  const channelId = await page.evaluate((name: string) => {
    const items = document.querySelectorAll(
      '[data-qa="channel_sidebar_channel"], .p-channel_sidebar__channel'
    );
    for (const item of items) {
      const nameEl = item.querySelector(
        '[data-qa="channel_sidebar_name_btn"], .p-channel_sidebar__name'
      );
      const itemName = nameEl?.textContent?.trim() ?? "";
      if (
        itemName === name ||
        itemName.toLowerCase() === name.toLowerCase()
      ) {
        return (
          item.getAttribute("data-qa-channel-sidebar-channel-id") ??
          item
            .querySelector("a")
            ?.getAttribute("href")
            ?.match(/\/([A-Z0-9]+)$/)?.[1] ??
          null
        );
      }
    }
    // 部分一致
    for (const item of items) {
      const nameEl = item.querySelector(
        '[data-qa="channel_sidebar_name_btn"], .p-channel_sidebar__name'
      );
      const itemName = nameEl?.textContent?.trim() ?? "";
      if (itemName.toLowerCase().includes(name.toLowerCase())) {
        return (
          item.getAttribute("data-qa-channel-sidebar-channel-id") ??
          item
            .querySelector("a")
            ?.getAttribute("href")
            ?.match(/\/([A-Z0-9]+)$/)?.[1] ??
          null
        );
      }
    }
    return null;
  }, channelName);

  if (!channelId) {
    throw new Error(
      `チャンネル "${channelName}" の ID を解決できませんでした。サイドバーにチャンネルが表示されていることを確認してください。`
    );
  }

  return channelId;
}

/**
 * スレッドパネルが表示されるまで待機する。
 */
async function waitForThreadPanel(page: Page): Promise<void> {
  const selectors = [
    ".p-flexpane__body",
    '[data-qa="threads_flexpane"]',
    ".p-thread_view",
    '[data-qa="thread_view"]',
    ".p-flexpane",
  ];

  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      // スレッド内メッセージがレンダリングされるまで追加待機
      await new Promise((r) => setTimeout(r, 1_500));
      return;
    } catch {
      // 次のセレクタを試行
    }
  }

  console.error(
    "スレッドパネルのセレクタが見つかりませんでした。2 秒待機して続行します..."
  );
  await new Promise((r) => setTimeout(r, 2_000));
}

/**
 * スレッドパネルから親メッセージと返信を抽出する。
 */
async function extractThread(page: Page): Promise<SlackThread> {
  const data = await page.evaluate(() => {
    // スレッドパネルを特定
    const panel =
      document.querySelector(".p-flexpane__body") ??
      document.querySelector('[data-qa="threads_flexpane"]') ??
      document.querySelector(".p-thread_view") ??
      document.querySelector('[data-qa="thread_view"]') ??
      document.querySelector(".p-flexpane");

    if (!panel) {
      return {
        parent: { ts: "", user: "", text: "" },
        replies: [] as Array<{ ts: string; user: string; text: string; replyCount?: number }>,
      };
    }

    const extractMessage = (
      el: Element
    ): { ts: string; user: string; text: string; replyCount?: number } => {
      const tsEl = el.querySelector("a.c-timestamp");
      const ts =
        tsEl?.getAttribute("data-ts") ??
        tsEl?.getAttribute("href")?.match(/p(\d+)/)?.[1] ??
        "";

      const senderEl = el.querySelector(
        ".c-message__sender_button, [data-qa='message_sender_name']"
      );
      const user = senderEl?.textContent?.trim() ?? "";

      const textSections = el.querySelectorAll(
        ".p-rich_text_section, .c-message_kit__text .p-rich_text_block"
      );
      let text = "";
      if (textSections.length > 0) {
        text = Array.from(textSections)
          .map((s) => (s as HTMLElement).innerText?.trim() ?? "")
          .filter(Boolean)
          .join("\n");
      } else {
        const bodyEl = el.querySelector(
          '[data-qa="message-text"], .c-message_kit__text'
        );
        text = (bodyEl as HTMLElement | null)?.innerText?.trim() ?? "";
      }

      return { ts, user, text };
    };

    // スレッド内のメッセージ要素をすべて取得
    const messageEls = panel.querySelectorAll(
      '.c-message_kit__gutter, [data-qa="virtual-list-item"]'
    );

    const messages: Array<{
      ts: string;
      user: string;
      text: string;
      replyCount?: number;
    }> = [];
    for (const el of messageEls) {
      const msg = extractMessage(el);
      if (msg.ts || msg.user || msg.text) {
        messages.push(msg);
      }
    }

    // 最初のメッセージを親、残りを返信
    const parent = messages.length > 0
      ? messages[0]
      : { ts: "", user: "", text: "" };
    const replies = messages.length > 1 ? messages.slice(1) : [];

    return { parent, replies };
  });

  return data;
}

/**
 * フォールバック: チャンネルに遷移してからメッセージを探し、スレッドを開く。
 */
async function openThreadFromChannel(
  page: Page,
  teamId: string,
  channelId: string,
  ts: string
): Promise<SlackThread> {
  // チャンネルに遷移
  const channelUrl = `https://app.slack.com/client/${teamId}/${channelId}`;
  await page.goto(channelUrl, { waitUntil: "networkidle2", timeout: 30_000 });
  await waitForSlack(page);
  await new Promise((r) => setTimeout(r, 2_000));

  // 対象タイムスタンプのメッセージを探してスレッドボタンをクリック
  const clicked = await page.evaluate((targetTs: string) => {
    const containers = document.querySelectorAll(
      '.c-message_kit__gutter, [data-qa="virtual-list-item"]'
    );
    for (const container of containers) {
      const tsEl = container.querySelector("a.c-timestamp");
      const msgTs =
        tsEl?.getAttribute("data-ts") ??
        tsEl?.getAttribute("href")?.match(/p(\d+)/)?.[1] ??
        "";

      if (msgTs === targetTs) {
        // ホバーしてアクションボタンを表示
        const event = new MouseEvent("mouseenter", { bubbles: true });
        container.dispatchEvent(event);

        // リプライボタンをクリック
        const replyBtn =
          container.querySelector(".c-message__reply_count") ??
          container.querySelector('[data-qa="reply-in-thread"]') ??
          container.querySelector(
            'button[aria-label="Reply in thread"], button[aria-label="スレッドで返信する"]'
          );

        if (replyBtn) {
          (replyBtn as HTMLElement).click();
          return true;
        }
        return false;
      }
    }
    return false;
  }, ts);

  if (!clicked) {
    throw new Error(
      `タイムスタンプ "${ts}" のメッセージが見つかりませんでした。メッセージが表示範囲内にあることを確認してください。`
    );
  }

  // スレッドパネルが表示されるまで待機
  await waitForThreadPanel(page);

  const thread = await extractThread(page);
  console.error(
    `スレッド: 親メッセージ + ${thread.replies.length} 件の返信`
  );
  return thread;
}
