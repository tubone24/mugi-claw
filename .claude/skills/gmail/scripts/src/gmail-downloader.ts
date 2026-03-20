import type { Page } from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface DownloadResult {
  filename: string;
  path: string;
}

/**
 * スレッドの添付ファイルをダウンロード
 */
export async function downloadAttachments(
  page: Page,
  threadId: string,
  outputDir: string
): Promise<DownloadResult[]> {
  // 出力ディレクトリを作成
  await mkdir(outputDir, { recursive: true });

  const url = `https://mail.google.com/mail/u/0/#all/${threadId}`;
  console.error(`スレッドを開いています: ${url}`);

  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  // CDPセッションを取得してダウンロード先を設定
  const client = await page.createCDPSession();
  await client.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: outputDir,
  });

  // 添付ファイル要素を検出
  const attachments = await page.evaluate(() => {
    const results: Array<{ filename: string; index: number }> = [];

    // 添付ファイルのセレクタパターン
    const attachmentEls = document.querySelectorAll(
      'div.aQH span.aV3, div[data-tooltip][download_url], a[download], span.aZo'
    );

    let index = 0;
    for (const el of attachmentEls) {
      const filename =
        (el as HTMLElement).getAttribute("data-tooltip") ??
        (el as HTMLElement).innerText?.trim() ??
        `attachment_${index}`;
      results.push({ filename, index });
      index++;
    }

    return results;
  });

  if (attachments.length === 0) {
    console.error("添付ファイルが見つかりません");
    return [];
  }

  console.error(`${attachments.length} 件の添付ファイルを検出`);

  const results: DownloadResult[] = [];

  // 各添付ファイルをダウンロード
  for (const attachment of attachments) {
    try {
      // ダウンロードボタンをクリック
      await page.evaluate((idx) => {
        const downloadBtns = document.querySelectorAll(
          'div.aQH span.aV3, div[data-tooltip][download_url], a[download], span.aZo'
        );
        const btn = downloadBtns[idx];
        if (btn) {
          // ダウンロードアイコンまたは添付ファイル名をクリック
          const downloadIcon =
            btn.closest("div.aQH")?.querySelector('div[aria-label*="ダウンロード"], div[data-tooltip="ダウンロード"]') ??
            btn;
          (downloadIcon as HTMLElement).click();
        }
      }, attachment.index);

      // ダウンロード完了待ち
      await new Promise((r) => setTimeout(r, 3000));

      results.push({
        filename: attachment.filename,
        path: join(outputDir, attachment.filename),
      });

      console.error(`  ダウンロード: ${attachment.filename}`);
    } catch (err: any) {
      console.error(
        `  エラー (${attachment.filename}): ${err.message}`
      );
    }
  }

  await client.detach();
  return results;
}
