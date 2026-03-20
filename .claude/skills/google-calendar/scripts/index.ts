import { program } from "commander";
import { listProfiles, findProfile } from "../../shared/scripts/src/chrome-profiles.js";
import { launchChrome, connectToExisting } from "../../shared/scripts/src/chrome-launcher.js";
import { fetchCalendarEvents } from "./calendar-fetcher.js";
import { formatEvents, type OutputFormat } from "./formatter.js";

program.name("calendar-cdp").description("Google Calendar CDP CLI ツール");

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

// events コマンド
program
  .command("events")
  .description("Google Calendar のイベントを取得")
  .option("-p, --profile <name>", "Chrome プロファイル名")
  .option("--start <YYYY-MM-DD>", "開始日")
  .option("--end <YYYY-MM-DD>", "終了日")
  .option("--date <YYYY-MM-DD>", "対象日 (1日のみ)")
  .option("--format <type>", "出力形式 (json/text)", "text")
  .option("--no-launch", "Chrome を起動せず既存に接続")
  .option("--port <number>", "デバッグポート番号", "9222")
  .action(async (opts) => {
    try {
      const port = parseInt(opts.port, 10);
      const format = opts.format as OutputFormat;

      // 日付範囲の決定
      const today = new Date().toISOString().split("T")[0];
      let startDate: string;
      let endDate: string;

      if (opts.date) {
        startDate = opts.date;
        endDate = opts.date;
      } else {
        startDate = opts.start ?? today;
        endDate = opts.end ?? today;
      }

      let browser;

      if (!opts.launch) {
        browser = await connectToExisting(port);
      } else {
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

        console.error(`プロファイル "${profile.name}" (${profile.directory}) を使用`);
        const result = await launchChrome(profile.directory, port);
        browser = result.browser;
      }

      const events = await fetchCalendarEvents(browser, startDate, endDate);
      console.log(formatEvents(events, format));

      await browser.disconnect();
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
