import type { Page } from "puppeteer-core";

// ─── インターフェース ────────────────────────────────────────────
export interface SlackChannel {
  id: string;
  name: string;
  type: "channel" | "dm" | "group";
  unread: boolean;
}

export interface SlackMessage {
  ts: string;
  user: string;
  text: string;
  replyCount?: number;
}

// ─── ヘルパー ────────────────────────────────────────────────────

/**
 * 現在の URL から Slack チーム ID を取得する。
 * Slack 上でなければ https://app.slack.com に遷移してから取得する。
 */
export async function getTeamId(page: Page): Promise<string> {
  const currentUrl = page.url();
  const match = currentUrl.match(
    /https:\/\/app\.slack\.com\/client\/([A-Z0-9]+)/
  );
  if (match) return match[1];

  // Slack を開いていない場合はトップに遷移
  console.error("Slack が開かれていないため、app.slack.com に遷移します...");
  await page.goto("https://app.slack.com", {
    waitUntil: "networkidle2",
    timeout: 30_000,
  });
  await waitForSlack(page);

  const newUrl = page.url();
  const m2 = newUrl.match(
    /https:\/\/app\.slack\.com\/client\/([A-Z0-9]+)/
  );
  if (m2) return m2[1];

  throw new Error(
    "チーム ID を取得できませんでした。Slack にログイン済みのブラウザを使用してください。"
  );
}

/**
 * Slack の UI が読み込まれるまで待機する。
 */
export async function waitForSlack(page: Page): Promise<void> {
  const selectors = [
    ".p-channel_sidebar",
    "[data-qa='channel_sidebar']",
    ".p-workspace__primary_view",
    ".p-client_workspace",
    'button[data-qa="top_nav_search"]',
  ];

  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 15_000 });
      return;
    } catch {
      // 次のセレクタを試行
    }
  }
  // どれにもマッチしなくても一定時間は待つ
  console.error(
    "サイドバーセレクタが見つかりませんでした。2 秒待機して続行します..."
  );
  await new Promise((r) => setTimeout(r, 2_000));
}

// ─── fetchChannels ───────────────────────────────────────────────

/**
 * サイドバーからチャンネル / DM / グループ一覧を取得する。
 */
export async function fetchChannels(page: Page): Promise<SlackChannel[]> {
  await waitForSlack(page);

  // サイドバーが完全にレンダリングされるまで少し待つ
  await new Promise((r) => setTimeout(r, 1_500));

  const channels = await page.evaluate(() => {
    const results: Array<{
      id: string;
      name: string;
      type: "channel" | "dm" | "group";
      unread: boolean;
    }> = [];

    // チャンネルアイテムを取得
    const items = document.querySelectorAll(
      '[data-qa="channel_sidebar_channel"], .p-channel_sidebar__channel'
    );

    for (const item of items) {
      const el = item as HTMLElement;

      // チャンネル ID を取得
      const id =
        el.getAttribute("data-qa-channel-sidebar-channel-id") ??
        el
          .querySelector("a")
          ?.getAttribute("href")
          ?.match(/\/([A-Z0-9]+)$/)?.[1] ??
        "";

      // チャンネル名を取得
      const nameBtn = el.querySelector(
        '[data-qa="channel_sidebar_name_btn"], .p-channel_sidebar__name'
      );
      const name = nameBtn?.textContent?.trim() ?? "";

      if (!name) continue;

      // タイプ判定 — アイコンやプレフィックスで判定
      let type: "channel" | "dm" | "group" = "channel";

      const iconEl = el.querySelector(
        '[data-qa="channel-prefix"], .p-channel_sidebar__channel_icon'
      );
      const iconHtml = iconEl?.innerHTML ?? "";
      const ariaLabel =
        el.getAttribute("aria-label") ??
        nameBtn?.getAttribute("aria-label") ??
        "";

      if (
        iconHtml.includes("lock") ||
        ariaLabel.toLowerCase().includes("private") ||
        ariaLabel.includes("プライベート")
      ) {
        type = "group";
      } else if (
        iconHtml.includes("presence") ||
        iconHtml.includes("avatar") ||
        ariaLabel.toLowerCase().includes("direct message") ||
        ariaLabel.includes("ダイレクトメッセージ") ||
        el.closest('[data-qa="starred-dm"]') !== null ||
        el.closest(".p-channel_sidebar__section--direct_messages") !== null
      ) {
        type = "dm";
      }

      // 未読状態を判定
      const unread =
        el.classList.contains("p-channel_sidebar__channel--unread") ||
        el.querySelector(".p-channel_sidebar__badge") !== null ||
        el.querySelector('[data-qa="sidebar-badge"]') !== null ||
        (nameBtn as HTMLElement | null)?.style?.fontWeight === "bold" ||
        el.getAttribute("data-qa-unread") === "true";

      results.push({ id, name, type, unread });
    }

    return results;
  });

  console.error(`${channels.length} 件のチャンネルを取得しました`);
  return channels;
}

// ─── fetchMessages ───────────────────────────────────────────────

/**
 * 指定チャンネルのメッセージを取得する。
 */
export async function fetchMessages(
  page: Page,
  channelNameOrId: string,
  opts: { limit: number }
): Promise<SlackMessage[]> {
  const teamId = await getTeamId(page);

  // チャンネル ID っぽい場合は直接遷移
  if (/^[CD][A-Z0-9]+$/.test(channelNameOrId)) {
    const url = `https://app.slack.com/client/${teamId}/${channelNameOrId}`;
    console.error(`チャンネル ${channelNameOrId} に直接遷移します...`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
  } else {
    // サイドバーからチャンネルを探してクリック、失敗したら URL で遷移
    const navigated = await navigateToChannelByName(
      page,
      teamId,
      channelNameOrId
    );
    if (!navigated) {
      throw new Error(
        `チャンネル "${channelNameOrId}" が見つかりませんでした。チャンネル名または ID を確認してください。`
      );
    }
  }

  // メッセージリストが読み込まれるまで待機
  await waitForMessages(page);

  // 必要に応じてスクロールしてメッセージを読み込む
  const messages = await extractMessages(page, opts.limit);

  console.error(`${messages.length} 件のメッセージを取得しました`);
  return messages;
}

/**
 * サイドバーからチャンネル名をクリックして遷移する。
 * 見つからない場合は false を返す。
 */
async function navigateToChannelByName(
  page: Page,
  teamId: string,
  channelName: string
): Promise<boolean> {
  await waitForSlack(page);

  // サイドバーで名前をテキスト検索してクリック
  const clicked = await page.evaluate((name: string) => {
    const btns = document.querySelectorAll(
      '[data-qa="channel_sidebar_name_btn"], .p-channel_sidebar__name'
    );
    for (const btn of btns) {
      if (btn.textContent?.trim() === name) {
        (btn as HTMLElement).click();
        return true;
      }
    }
    // 部分一致でも試す
    for (const btn of btns) {
      if (
        btn.textContent
          ?.trim()
          .toLowerCase()
          .includes(name.toLowerCase())
      ) {
        (btn as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, channelName);

  if (clicked) {
    // 遷移を待つ
    await new Promise((r) => setTimeout(r, 2_000));
    return true;
  }

  // サイドバーになければ検索経由でチャンネル一覧から探してみる
  // フォールバック: URL 直接遷移を試みる（チャンネル名 → ID 変換できないのでサイドバーから ID を推定）
  const channelId = await page.evaluate((name: string) => {
    const items = document.querySelectorAll(
      '[data-qa="channel_sidebar_channel"], .p-channel_sidebar__channel'
    );
    for (const item of items) {
      const nameEl = item.querySelector(
        '[data-qa="channel_sidebar_name_btn"], .p-channel_sidebar__name'
      );
      if (
        nameEl?.textContent
          ?.trim()
          .toLowerCase()
          .includes(name.toLowerCase())
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
    return null;
  }, channelName);

  if (channelId) {
    const url = `https://app.slack.com/client/${teamId}/${channelId}`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 2_000));
    return true;
  }

  return false;
}

/**
 * メッセージ一覧の読み込みを待機する。
 */
async function waitForMessages(page: Page): Promise<void> {
  const selectors = [
    ".c-message_kit__gutter",
    '[data-qa="virtual-list-item"]',
    ".c-message_list__day_divider",
  ];
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      return;
    } catch {
      // 次のセレクタを試行
    }
  }
  // セレクタが見つからなくても続行
  console.error(
    "メッセージセレクタが見つかりませんでした。2 秒待機して続行します..."
  );
  await new Promise((r) => setTimeout(r, 2_000));
}

/**
 * 表示中のメッセージを DOM から抽出する。
 * limit に達するまでスクロールアップして読み込む。
 */
async function extractMessages(
  page: Page,
  limit: number
): Promise<SlackMessage[]> {
  const allMessages: SlackMessage[] = [];
  const seenTs = new Set<string>();
  let scrollAttempts = 0;``
  const maxScrollAttempts = 20;

  while (allMessages.length < limit && scrollAttempts < maxScrollAttempts) {
    const batch = await page.evaluate(() => {
      const results: Array<{
        ts: string;
        user: string;
        text: string;
        replyCount?: number;
      }> = [];

      const containers = document.querySelectorAll(
        '.c-message_kit__gutter, [data-qa="virtual-list-item"]'
      );

      for (const container of containers) {
        const el = container as HTMLElement;

        // タイムスタンプ
        const tsEl = el.querySelector("a.c-timestamp");
        const ts =
          tsEl?.getAttribute("data-ts") ??
          tsEl?.getAttribute("href")?.match(/p(\d+)/)?.[1] ??
          "";

        // 送信者
        const senderEl = el.querySelector(
          ".c-message__sender_button, [data-qa='message_sender_name']"
        );
        const user = senderEl?.textContent?.trim() ?? "";

        // テキスト — 複数セクションを結合
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
          // フォールバック: メッセージテキスト全体
          const bodyEl = el.querySelector(
            '[data-qa="message-text"], .c-message_kit__text'
          );
          text = (bodyEl as HTMLElement | null)?.innerText?.trim() ?? "";
        }

        // リプライ数
        let replyCount: number | undefined;
        const replyEl = el.querySelector(
          ".c-message__reply_count, [data-qa='reply_count']"
        );
        if (replyEl) {
          const replyText = replyEl.textContent?.trim() ?? "";
          const num = parseInt(replyText.replace(/[^0-9]/g, ""), 10);
          if (!isNaN(num) && num > 0) replyCount = num;
        }

        if (ts || user || text) {
          results.push({ ts, user, text, replyCount });
        }
      }

      return results;
    });

    let newCount = 0;
    for (const msg of batch) {
      const key = msg.ts || `${msg.user}-${msg.text}`;
      if (!seenTs.has(key)) {
        seenTs.add(key);
        allMessages.push(msg);
        newCount++;
      }
    }

    // 新しいメッセージがなければスクロール
    if (newCount === 0) {
      scrollAttempts++;
    } else {
      scrollAttempts = 0; // 新しいものが見つかったらリセット
    }

    if (allMessages.length >= limit) break;

    // スクロールアップして古いメッセージを読み込む
    await page.evaluate(() => {
      const scrollContainer = document.querySelector(
        '.c-virtual_list__scroll_container, [data-qa="slack_kit_list"], .p-workspace__primary_view_body'
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      } else {
        window.scrollTo(0, 0);
      }
    });
    await new Promise((r) => setTimeout(r, 1_500));
  }

  // タイムスタンプ順にソート
  allMessages.sort((a, b) => {
    if (!a.ts || !b.ts) return 0;
    return a.ts.localeCompare(b.ts);
  });

  return allMessages.slice(0, limit);
}

// ─── searchMessages ──────────────────────────────────────────────

/**
 * Slack 内でメッセージを検索する。
 * 検索ボタンをクリック → キーボード入力 → Enter で検索を実行する。
 */
export async function searchMessages(
  page: Page,
  query: string,
  opts: { limit: number }
): Promise<SlackMessage[]> {
  const teamId = await getTeamId(page);

  // 1. クリーンな状態にするため、チャンネルページに強制遷移
  //    Slack SPA は page.goto でもリダイレクトすることがあるため
  //    window.location.href で強制的にフルリロードする
  console.error("チャンネルページに遷移します...");
  await page.evaluate(
    (url: string) => { window.location.href = url; },
    `https://app.slack.com/client/${teamId}/unreads`
  );
  await new Promise((r) => setTimeout(r, 5_000));
  await waitForSlack(page);

  console.error(`"${query}" を検索しています...`);

  // 2. 検索ボタンをクリックして検索ダイアログを開く
  const searchBtnSelectors = [
    'button[data-qa="top_nav_search"]',
    '[aria-label="検索"]',
    '[aria-label="Search"]',
  ];

  let dialogOpened = false;
  for (const sel of searchBtnSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await new Promise((r) => setTimeout(r, 2_000));
        dialogOpened = true;
        break;
      }
    } catch {
      // 次のセレクタを試行
    }
  }

  if (!dialogOpened) {
    console.error("検索ボタンが見つかりませんでした。");
    return [];
  }

  // 3. 検索入力欄をプログラム的にクリアしてクエリを入力
  //    contenteditable 要素の場合、Cmd+A が効かないことがあるため
  //    selectAll + delete で確実にクリアする
  await page.evaluate(() => {
    document.execCommand("selectAll", false);
  });
  await page.keyboard.press("Backspace");
  await new Promise((r) => setTimeout(r, 300));

  await page.keyboard.type(query, { delay: 30 });
  await new Promise((r) => setTimeout(r, 1_000));

  // 4. Enter を押して検索を実行
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 5_000));

  // 5. 検索結果ページが読み込まれるまでポーリング
  //    検索結果は仮想スクロールで遅延レンダリングされるため、十分に待機する
  let resultsLoaded = false;

  for (let attempt = 0; attempt < 20; attempt++) {
    // URL が /search に遷移しているか確認
    const url = page.url();
    if (!url.includes("/search")) {
      await new Promise((r) => setTimeout(r, 1_000));
      continue;
    }

    // 検索結果のメッセージ要素があるか確認
    const resultCount = await page.evaluate(() => {
      // data-qa="search_result" を探す
      const r1 = document.querySelectorAll('[data-qa="search_result"]');
      if (r1.length > 0) return r1.length;

      // message_sender_name を探す（検索結果内のメッセージ）
      const r2 = document.querySelectorAll('[data-qa="message_sender_name"]');
      if (r2.length > 0) return r2.length;

      // message-text を探す
      const r3 = document.querySelectorAll('[data-qa="message-text"]');
      if (r3.length > 0) return r3.length;

      return 0;
    });

    if (resultCount > 0) {
      console.error(`検索結果のDOM要素を ${resultCount} 件検出しました`);
      resultsLoaded = true;
      break;
    }

    await new Promise((r) => setTimeout(r, 1_000));
  }

  if (!resultsLoaded) {
    console.error("検索結果が見つかりませんでした。クエリを確認してください。");
    return [];
  }

  // 5. 検索結果を抽出
  const messages = await extractSearchResults(page, opts.limit);
  console.error(`検索結果: ${messages.length} 件`);
  return messages;
}

/**
 * 検索結果ページからメッセージを抽出する。
 * data-qa="search_result" を使用してメッセージを取得する。
 */
async function extractSearchResults(
  page: Page,
  limit: number
): Promise<SlackMessage[]> {
  const allMessages: SlackMessage[] = [];
  const seenKeys = new Set<string>();
  let scrollAttempts = 0;
  const maxScrollAttempts = 10;

  while (allMessages.length < limit && scrollAttempts < maxScrollAttempts) {
    const batch = await page.evaluate(() => {
      const results: Array<{
        ts: string;
        user: string;
        text: string;
        channel?: string;
        replyCount?: number;
      }> = [];

      // data-qa="search_result" で各検索結果を取得
      const containers = document.querySelectorAll(
        '[data-qa="search_result"]'
      );

      for (const container of containers) {
        const el = container as HTMLElement;

        // タイムスタンプ
        const tsEl = el.querySelector("a.c-timestamp, .c-timestamp");
        const ts =
          tsEl?.getAttribute("data-ts") ??
          tsEl?.getAttribute("href")?.match(/\/p(\d+)/)?.[1] ??
          "";

        // 送信者
        const senderEl = el.querySelector(
          '[data-qa="message_sender_name"]'
        );
        const user = senderEl?.textContent?.trim() ?? "";

        // チャンネル名
        const channelEl = el.querySelector(
          '[data-qa="search_result_channel_name"]'
        );
        const channel = channelEl?.textContent?.trim() ?? "";

        // テキスト
        const textEl = el.querySelector('[data-qa="message-text"]');
        let text = "";
        if (textEl) {
          text = (textEl as HTMLElement).innerText?.trim() ?? "";
        } else {
          // フォールバック
          const richText = el.querySelectorAll(".p-rich_text_section");
          if (richText.length > 0) {
            text = Array.from(richText)
              .map((s) => (s as HTMLElement).innerText?.trim() ?? "")
              .filter(Boolean)
              .join("\n");
          }
        }

        // チャンネル名をテキストに付加（検索結果ではどこの投稿かが重要）
        const fullText = channel
          ? `[#${channel}] ${text}`
          : text;

        if (ts || user || fullText) {
          results.push({ ts, user, text: fullText, channel });
        }
      }

      return results;
    });

    let newCount = 0;
    for (const msg of batch) {
      const key = msg.ts || `${msg.user}-${msg.text}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allMessages.push(msg);
        newCount++;
      }
    }

    if (newCount === 0) {
      scrollAttempts++;
    } else {
      scrollAttempts = 0;
    }

    if (allMessages.length >= limit) break;

    // スクロールダウンして結果を読み込む
    await page.evaluate(() => {
      const scrollContainer = document.querySelector(
        '[data-qa="search_view"], .p-search_results__list, .c-virtual_list__scroll_container'
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }
    });
    await new Promise((r) => setTimeout(r, 1_500));
  }

  // タイムスタンプ順にソート
  allMessages.sort((a, b) => {
    if (!a.ts || !b.ts) return 0;
    return a.ts.localeCompare(b.ts);
  });

  return allMessages.slice(0, limit);
}
