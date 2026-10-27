import { fetch } from "@tauri-apps/plugin-http";
import { uq, uexec } from "./db";

// Public CatseyeXI site API. Every response is cached in user.db so the app works offline;
// network is only hit when there's no cache or the caller asks to refresh.
const BASE = "https://catseyexi.com/api";

export type Cached<T> = { data: T; fetchedAt: number; stale?: string };

export async function cx<T>(path: string, refresh = false): Promise<Cached<T>> {
  const url = BASE + path;
  const [hit] = await uq<{ body: string; fetched_at: number }>("SELECT body, fetched_at FROM api_cache WHERE url=$1", url);
  if (hit && !refresh) return { data: JSON.parse(hit.body), fetchedAt: hit.fetched_at };
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    JSON.parse(body); // don't cache HTML error pages
    const now = Date.now();
    await uexec("INSERT OR REPLACE INTO api_cache VALUES ($1,$2,$3)", url, body, now);
    return { data: JSON.parse(body), fetchedAt: now };
  } catch (e) {
    if (hit) return { data: JSON.parse(hit.body), fetchedAt: hit.fetched_at, stale: String(e) };
    throw e;
  }
}

export type Character = {
  charid: number; charname: string; nation: number; pos_zone: number; pos_x: number; pos_y: number; pos_z: number;
  mjob: string; sjob: string; mlvl: string; slvl: string; accountType: number; race: string;
  rank_sandoria: number; rank_bastok: number; rank_windurst: number;
  jobs: Record<string, number>; exp: Record<string, number>; crafts: Record<string, number>;
  equipment: Record<string, number>; relics: string[]; mythics: string[]; isOnline: boolean;
};
export type CxItem = {
  item: { itemid: number; name: string; level: number; jobs: number; slot: number };
  mods: { modId?: number; modid?: number; value: number }[];
  weapon?: { dmg: number; delay: number; skill: number };
};
export type CxMob = { mobid: number; mobname: string; family: number; minLevel: number | null; maxLevel: number | null };

export const getChar = (id: string, refresh = false) =>
  cx<{ character: Character }>(`/char/${id}`, refresh).then((r) => ({ ...r, data: r.data.character }));
export const getOwned = (id: string, refresh = false) =>
  cx<{ ownedItems: number[] }>(`/char/${id}/inventory`, refresh).then((r) => new Set(r.data.ownedItems));
export const getItem = (id: number) => cx<CxItem>(`/item/${id}`);
export const searchMobs = (q: string) => cx<{ mobs: CxMob[] }>(`/search/mobs?q=${encodeURIComponent(q)}`);

// Accepts "25929", "catseyexi.com/char/25929", etc.
export const parseCharId = (s: string) => s.match(/(\d+)\s*$/)?.[1] ?? s.match(/char\/(\d+)/)?.[1];
