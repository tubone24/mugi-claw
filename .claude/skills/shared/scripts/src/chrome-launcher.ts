import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import puppeteer, { type Browser } from "puppeteer-core";
import { getChromeUserDataDir } from "./chrome-profiles.js";

const CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

interface LaunchResult {
  browser: Browser;
  process?: ChildProcess;
  userDataDir?: string;
}

async function isDebugPortOpen(port: number): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    const json = (await res.json()) as { webSocketDebuggerUrl?: string };
    return json.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  }
}

export async function connectToExisting(port: number): Promise<Browser> {
  const wsUrl = await isDebugPortOpen(port);
  if (!wsUrl) {
    throw new Error(
      `ポート ${port} で Chrome のデバッグエンドポイントが見つかりません`
    );
  }
  return puppeteer.connect({ browserWSEndpoint: wsUrl });
}

export async function launchChrome(
  profileDirectory: string,
  port: number = 9222
): Promise<LaunchResult> {
  const existingWs = await isDebugPortOpen(port);
  if (existingWs) {
    console.error(
      `ポート ${port} で既存の Chrome を検出しました。接続します...`
    );
    const browser = await puppeteer.connect({
      browserWSEndpoint: existingWs,
    });
    return { browser };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "calendar-cdp-"));
  const srcProfileDir = join(getChromeUserDataDir(), profileDirectory);
  const destProfileDir = join(tempDir, profileDirectory);

  console.error(`プロファイル "${profileDirectory}" をコピー中...`);
  await cp(srcProfileDir, destProfileDir, { recursive: true });

  const srcLocalState = join(getChromeUserDataDir(), "Local State");
  const destLocalState = join(tempDir, "Local State");
  try {
    await cp(srcLocalState, destLocalState);
  } catch {
    // Local State がなくても続行可能
  }

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tempDir}`,
    `--profile-directory=${profileDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  console.error("Chrome を起動中...");
  const proc = spawn(CHROME_PATH, args, {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();

  let wsUrl: string | null = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    wsUrl = await isDebugPortOpen(port);
    if (wsUrl) break;
  }

  if (!wsUrl) {
    proc.kill();
    throw new Error("Chrome の起動がタイムアウトしました");
  }

  const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
  return { browser, process: proc, userDataDir: tempDir };
}
