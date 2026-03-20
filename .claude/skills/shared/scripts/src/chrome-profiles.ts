import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ChromeProfile {
  directory: string;
  name: string;
  userName: string;
  gaiaName: string;
}

const CHROME_USER_DATA_DIR = join(
  homedir(),
  "Library",
  "Application Support",
  "Google",
  "Chrome"
);

export function getChromeUserDataDir(): string {
  return CHROME_USER_DATA_DIR;
}

export async function listProfiles(): Promise<ChromeProfile[]> {
  const localStatePath = join(CHROME_USER_DATA_DIR, "Local State");
  const raw = await readFile(localStatePath, "utf-8");
  const localState = JSON.parse(raw);

  const infoCache = localState?.profile?.info_cache;
  if (!infoCache || typeof infoCache !== "object") {
    throw new Error("profile.info_cache が Local State に見つかりません");
  }

  return Object.entries(infoCache).map(([directory, info]: [string, any]) => ({
    directory,
    name: info.name ?? "",
    userName: info.user_name ?? "",
    gaiaName: info.gaia_name ?? "",
  }));
}

export async function findProfile(
  query: string
): Promise<ChromeProfile | undefined> {
  const profiles = await listProfiles();
  const lower = query.toLowerCase();
  return profiles.find(
    (p) =>
      p.name.toLowerCase().includes(lower) ||
      p.directory.toLowerCase() === lower ||
      p.userName.toLowerCase().includes(lower)
  );
}
