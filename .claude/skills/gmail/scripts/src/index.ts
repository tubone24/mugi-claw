import { program } from "commander";
import {
  listProfiles,
  findProfile,
} from "../../../shared/scripts/src/chrome-profiles.js";
import {
  launchChrome,
  connectToExisting,
} from "../../../shared/scripts/src/chrome-launcher.js";
import { fetchMailList } from "./gmail-fetcher.js";
import { readThread } from "./gmail-reader.js";
import { downloadAttachments } from "./gmail-downloader.js";
import {
  formatMailList,
  formatThread,
  formatDownloadResults,
  type OutputFormat,
} from "./formatter.js";
import type { Browser } from "puppeteer-core";

program.name("gmail-cdp").description("Gmail CDP CLI ツール");

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

// list コマンド
program
  .command("list")
  .description("メール一覧を取得")
  .option("-p, --profile <name>", "Chrome プロファイル名")
  .option("--label <name>", "ラベル名")
  .option("--limit <n>", "取得件数上限", "50")
  .option("--format <type>", "出力形式 (json/text)", "text")
  .option("--no-launch", "Chrome を起動せず既存に接続")
  .option("--port <number>", "デバッグポート番号", "9222")
  .action(async (opts) => {
    try {
      const browser = await getBrowser(opts);
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();

      const messages = await fetchMailList(page, {
        label: opts.label,
        limit: parseInt(opts.limit, 10),
      });

      console.log(formatMailList(messages, opts.format as OutputFormat));
      await browser.disconnect();
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

// search コマンド
program
  .command("search")
  .description("メールを検索")
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

      const messages = await fetchMailList(page, {
        query: opts.query,
        limit: parseInt(opts.limit, 10),
      });

      console.log(formatMailList(messages, opts.format as OutputFormat));
      await browser.disconnect();
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

// read コマンド
program
  .command("read")
  .description("メール本文を読み取る")
  .option("-p, --profile <name>", "Chrome プロファイル名")
  .requiredOption("--thread <threadId>", "スレッドID")
  .option("--format <type>", "出力形式 (json/text)", "text")
  .option("--no-launch", "Chrome を起動せず既存に接続")
  .option("--port <number>", "デバッグポート番号", "9222")
  .action(async (opts) => {
    try {
      const browser = await getBrowser(opts);
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();

      const thread = await readThread(page, opts.thread);
      console.log(formatThread(thread, opts.format as OutputFormat));
      await browser.disconnect();
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

// download コマンド
program
  .command("download")
  .description("添付ファイルをダウンロード")
  .option("-p, --profile <name>", "Chrome プロファイル名")
  .requiredOption("--thread <threadId>", "スレッドID")
  .requiredOption("--output <dir>", "出力ディレクトリ")
  .option("--format <type>", "出力形式 (json/text)", "text")
  .option("--no-launch", "Chrome を起動せず既存に接続")
  .option("--port <number>", "デバッグポート番号", "9222")
  .action(async (opts) => {
    try {
      const browser = await getBrowser(opts);
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();

      const results = await downloadAttachments(page, opts.thread, opts.output);
      console.log(
        formatDownloadResults(results, opts.format as OutputFormat)
      );
      await browser.disconnect();
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
