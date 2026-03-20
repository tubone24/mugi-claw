import { program } from "commander";
import {
  listProfiles,
  findProfile,
} from "../../../shared/scripts/src/chrome-profiles.js";
import {
  launchChrome,
  connectToExisting,
} from "../../../shared/scripts/src/chrome-launcher.js";
import {
  fetchChannels,
  fetchMessages,
  searchMessages,
} from "./slack-fetcher.js";
import { readThread } from "./slack-reader.js";
import {
  formatChannels,
  formatMessages,
  formatThread,
  type OutputFormat,
} from "./formatter.js";
import type { Browser } from "puppeteer-core";

program.name("slack-cdp").description("Slack CDP CLI ツール");

/**
 * ブラウザ接続の共通処理
 */
async function getBrowser(opts: {
  launch: boolean;
  profile?: string;
  port: string;
}): Promise<Browser> {
  const port = parseInt(opts.port, 10);

  if (!opts.launch) {
    return connectToExisting(port);
  }

  if (!opts.profile) {
    console.error("エラー: --profile または --no-launch を指定してください");
    const profiles = await listProfiles();
    console.error("\n利用可能なプロファイル:");
    for (const p of profiles) {
      console.error(`  ${p.directory}: ${p.name}`);
    }
    process.exit(1);
  }

  const profile = await findProfile(opts.profile);
  if (!profile) {
    console.error(`エラー: プロファイル "${opts.profile}" が見つかりません`);
    process.exit(1);
  }

  console.error(
    `プロファイル "${profile.name}" (${profile.directory}) を使用`
  );
  const result = await launchChrome(profile.directory, port);
  return result.browser;
}

// profiles コマンド
program
  .command("profiles")
  .description("Chrome プロファイル一覧を表示")
  .action(async () => {
    try {
      const profiles = await listProfiles();
      for (const p of profiles) {
        const user = p.userName ? ` (${p.userName})` : "";
        console.log(`  ${p.directory}: ${p.name}${user}`);
      }
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

// channels コマンド
program
  .command("channels")
  .description("チャンネル/DM一覧を取得")
  .option("-p, --profile <name>", "Chrome プロファイル名")
  .option("--format <type>", "出力形式 (json/text)", "text")
  .option("--no-launch", "Chrome を起動せず既存に接続")
  .option("--port <number>", "デバッグポート番号", "9222")
  .action(async (opts) => {
    try {
      const browser = await getBrowser(opts);
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();

      // ビューポートを広くするとVirtual Scrollのデタッチが減る
      await page.setViewport({ width: 1440, height: 900 });

      const channels = await fetchChannels(page);
      console.log(formatChannels(channels, opts.format as OutputFormat));
      await browser.disconnect();
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

// messages コマンド
program
  .command("messages")
  .description("チャンネルのメッセージを取得")
  .option("-p, --profile <name>", "Chrome プロファイル名")
  .requiredOption("--channel <name>", "チャンネル名")
  .option("--limit <n>", "取得件数上限", "50")
  .option("--format <type>", "出力形式 (json/text)", "text")
  .option("--no-launch", "Chrome を起動せず既存に接続")
  .option("--port <number>", "デバッグポート番号", "9222")
  .action(async (opts) => {
    try {
      const browser = await getBrowser(opts);
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();

      // ビューポートを広くするとVirtual Scrollのデタッチが減る
      await page.setViewport({ width: 1440, height: 900 });

      const messages = await fetchMessages(page, opts.channel, {
        limit: parseInt(opts.limit, 10),
      });

      console.log(
        formatMessages(messages, opts.channel, opts.format as OutputFormat)
      );
      await browser.disconnect();
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

// search コマンド
program
  .command("search")
  .description("メッセージを検索")
  .option("-p, --profile <name>", "Chrome プロファイル名")
  .requiredOption("-q, --query <query>", "検索クエリ")
  .option("--limit <n>", "取得件数上限", "50")
  .option("--format <type>", "出力形式 (json/text)", "text")
  .option("--no-launch", "Chrome を起動せず既存に接続")
  .option("--port <number>", "デバッグポート番号", "9222")
  .action(async (opts) => {
    try {
      const browser = await getBrowser(opts);
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();

      await page.setViewport({ width: 1440, height: 900 });

      const messages = await searchMessages(page, opts.query, {
        limit: parseInt(opts.limit, 10),
      });

      // 検索結果はチャンネル名が不明なので query を代わりに使用
      console.log(
        formatMessages(messages, opts.query, opts.format as OutputFormat)
      );
      await browser.disconnect();
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

// thread コマンド
program
  .command("thread")
  .description("スレッドを読み取る")
  .option("-p, --profile <name>", "Chrome プロファイル名")
  .requiredOption("--channel <name>", "チャンネル名")
  .requiredOption("--ts <timestamp>", "メッセージのタイムスタンプ (ts)")
  .option("--format <type>", "出力形式 (json/text)", "text")
  .option("--no-launch", "Chrome を起動せず既存に接続")
  .option("--port <number>", "デバッグポート番号", "9222")
  .action(async (opts) => {
    try {
      const browser = await getBrowser(opts);
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();

      await page.setViewport({ width: 1440, height: 900 });

      const thread = await readThread(page, opts.channel, opts.ts);
      console.log(formatThread(thread, opts.format as OutputFormat));
      await browser.disconnect();
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
