import type { Page } from "puppeteer-core";

export interface DailyMix {
  index: number;
  title: string;
  description: string;
  url: string;
}

/**
 * Spotify ホームページから Daily Mix プレイリストを検索して一覧を返す
 */
export async function findDailyMixes(page: Page): Promise<DailyMix[]> {
  const homeUrl = "https://open.spotify.com";
  console.error(`Spotify を開いています: ${homeUrl}`);
  await page.goto(homeUrl, { waitUntil: "networkidle2", timeout: 30000 });

  // ホームページのコンテンツがレンダリングされるまで待機
  await page
    .waitForSelector('main [data-testid="home-page"]', { timeout: 15000 })
    .catch(() => {
      console.error(
        "ホームページセレクタが見つかりません。代替待機を実行..."
      );
    });

  // SPAのレンダリング完了を待つ
  await new Promise((r) => setTimeout(r, 3000));

  // スクロールして Daily Mix セクションを表示させる
  await autoScroll(page);

  // Daily Mix カードを DOM から検索
  const mixes = await page.evaluate(() => {
    const results: Array<{
      index: number;
      title: string;
      description: string;
      url: string;
    }> = [];

    // Daily Mix を含むリンクを探す
    const allLinks = document.querySelectorAll("a[href]");
    let idx = 0;
    for (const link of allLinks) {
      const el = link as HTMLAnchorElement;
      const text =
        el.textContent?.trim() ?? el.getAttribute("aria-label") ?? "";
      if (/daily\s*mix/i.test(text)) {
        const href = el.getAttribute("href") ?? "";
        // 重複排除 (同じ href)
        if (results.some((r) => r.url === href)) continue;

        idx++;
        // タイトルとサブテキストを取得
        const titleEl =
          el.querySelector('[data-testid="card-title"]') ??
          el.querySelector("p") ??
          el.querySelector("span");
        const title = (titleEl as HTMLElement)?.innerText?.trim() ?? text;

        const descEl =
          el.querySelector('[data-testid="card-subtitle"]') ??
          el.querySelectorAll("p")?.[1];
        const description =
          (descEl as HTMLElement)?.innerText?.trim() ?? "";

        const fullUrl = href.startsWith("http")
          ? href
          : `https://open.spotify.com${href}`;

        results.push({ index: idx, title, description, url: fullUrl });
      }
    }

    return results;
  });

  return mixes;
}

/**
 * 指定した Daily Mix プレイリストページを開いて再生する
 */
export async function playDailyMix(
  page: Page,
  mix: DailyMix
): Promise<{ success: boolean; message: string }> {
  console.error(`プレイリストを開いています: ${mix.url}`);
  await page.goto(mix.url, { waitUntil: "networkidle2", timeout: 30000 });

  // プレイリストページの読み込み待ち
  await page
    .waitForSelector('[data-testid="playlist-page"], [data-testid="action-bar-row"]', {
      timeout: 15000,
    })
    .catch(() => {
      console.error("プレイリストページセレクタが見つかりません。代替待機...");
    });

  await new Promise((r) => setTimeout(r, 2000));

  // 再生ボタンをクリック
  const played = await page.evaluate(() => {
    // プレイリストの大きな再生ボタンを探す
    const selectors = [
      'button[data-testid="play-button"]',
      '[data-testid="action-bar-row"] button[aria-label*="Play"]',
      '[data-testid="action-bar-row"] button[aria-label*="再生"]',
      'button[aria-label*="Play"]',
      'button[aria-label*="再生"]',
    ];

    for (const selector of selectors) {
      const btn = document.querySelector(selector) as HTMLButtonElement | null;
      if (btn) {
        btn.click();
        return { found: true, selector };
      }
    }

    return { found: false, selector: null };
  });

  if (played.found) {
    // 再生が始まったか確認するため少し待つ
    await new Promise((r) => setTimeout(r, 2000));

    const isPlaying = await page.evaluate(() => {
      const pauseBtn =
        document.querySelector(
          'button[data-testid="control-button-playpause"][aria-label*="Pause"]'
        ) ??
        document.querySelector(
          'button[data-testid="control-button-playpause"][aria-label*="一時停止"]'
        );
      return !!pauseBtn;
    });

    if (isPlaying) {
      return { success: true, message: `「${mix.title}」の再生を開始しました` };
    }
    return {
      success: true,
      message: `「${mix.title}」の再生ボタンをクリックしました（再生状態の確認は取れませんでした）`,
    };
  }

  return {
    success: false,
    message: "再生ボタンが見つかりませんでした。Spotify にログインしているか確認してください。",
  };
}

/**
 * ページを下にスクロールして遅延ロードのコンテンツを読み込む
 */
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const main =
      document.querySelector("main") ?? document.documentElement;
    const scrollTarget =
      main.querySelector("[data-overlayscrollbars-viewport]") ?? main;

    for (let i = 0; i < 5; i++) {
      scrollTarget.scrollBy(0, 600);
      await new Promise((r) => setTimeout(r, 800));
    }
    // 先頭に戻す
    scrollTarget.scrollTo(0, 0);
  });
}
