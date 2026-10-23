import { fetch } from "@tauri-apps/plugin-http";
import { exists, mkdir, writeFile, readDir } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";

// Zone maps come from bg-wiki (Square Enix maps with fan annotations), so they're downloaded to the user's own
// AppData on first use rather than shipped in the installer.
export type ZoneMapRow = { zoneid: number; file: string; label: string; url: string; w: number; h: number; a: number | null; b: number | null; c: number | null; d: number | null; n: number; rms: number | null };

const dir = async () => join(await appDataDir(), "maps");

export async function localMap(m: { file: string; url: string }): Promise<string> {
  const d = await dir();
  const path = await join(d, m.file);
  if (!(await exists(path))) {
    if (!(await exists(d))) await mkdir(d, { recursive: true });
    const res = await fetch(m.url, { headers: { "User-Agent": "ffxi-catseye-companion (personal tool)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${m.file}`);
    await writeFile(path, new Uint8Array(await res.arrayBuffer()));
  }
  return convertFileSrc(path);
}

export async function downloadedCount() {
  const d = await dir();
  return (await exists(d)) ? (await readDir(d)).length : 0;
}
