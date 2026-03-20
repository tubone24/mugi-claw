import { program } from "commander";
import {
  listProfiles,
  findProfile,
} from "../../../shared/scripts/src/chrome-profiles.js";
import {
  launchChrome,
  connectToExisting,
} from "../../../shared/scripts/src/chrome-launcher.js";
import { findDailyMixes, playDailyMix } from "./spotify-player.js";
import type { Browser } from "puppeteer-core";

program.name("spotify-cdp").description("Spotify Web Player CDP CLI ツール");

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

// list コマンド
program
  .command("list")
  .description("Daily Mix プレイリスト一覧を取得")
  .option("-p, --profile <name>", "Chrome プロファイル名")
  .option("--no-launch", "Chrome を起動せず既存に接続")
  .option("--port <number>", "デバッグポート番号", "9222")
  .action(async (opts) => {
    try {
      const browser = await getBrowser(opts);
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();

      const mixes = await findDailyMixes(page);

      if (mixes.length === 0) {
        console.log("Daily Mix が見つかりませんでした。Spotify にログインしているか確認してください。");
      } else {
        console.log(JSON.stringify(mixes, null, 2));
      }

      await browser.disconnect();
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

// play コマンド
program
  .command("play")
  .description("Daily Mix を再生")
  .option("-p, --profile <name>", "Chrome プロファイル名")
  .option("--index <n>", "再生する Daily Mix の番号（1始まり）", "1")
  .option("--no-launch", "Chrome を起動せず既存に接続")
  .option("--port <number>", "デバッグポート番号", "9222")
  .action(async (opts) => {
    try {
      const browser = await getBrowser(opts);
      const pages = await browser.pages();
      const page = pages.length > 0 ? pages[0] : await browser.newPage();

      console.error("Daily Mix を検索中...");
      const mixes = await findDailyMixes(page);

      if (mixes.length === 0) {
        console.log("Daily Mix が見つかりませんでした。Spotify にログインしているか確認してください。");
        await browser.disconnect();
        process.exit(1);
      }

      const targetIndex = parseInt(opts.index, 10);
      const target = mixes.find((m) => m.index === targetIndex);

      if (!target) {
        console.error(
          `エラー: Daily Mix #${targetIndex} が見つかりません。利用可能な Daily Mix:`
        );
        for (const m of mixes) {
          console.error(`  ${m.index}: ${m.title} - ${m.description}`);
        }
        await browser.disconnect();
        process.exit(1);
      }

      console.error(`再生対象: ${target.title}`);
      const result = await playDailyMix(page, target);
      console.log(JSON.stringify(result, null, 2));

      // 再生中なのでブラウザは閉じずに切断のみ
      await browser.disconnect();
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
