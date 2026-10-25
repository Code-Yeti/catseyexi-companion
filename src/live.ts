import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

// Data from the optional catseyecompanion Ashita addon (addon/catseyecompanion), which writes live.json into the
// app's AppData folder about once a second while the game runs. Everything here is optional: features fall back to
// the catseyexi.com API when there's no fresh file.
export type Live = {
  v: number; ts: number; char: string; zone: number;
  pos: { x: number; y: number; z: number }; // LandSandBoat convention: y is height
  mainJob: number; mainLevel: number; subJob: number; subLevel: number;
  target?: { name: string; index: number; id: number; hpp: number; mob: boolean };
  bluKnown?: [number, string][];            // [client spell id, name]
  bluSet?: number[];                        // client spell ids of set spells
  bluPoints?: { spent: number; max: number };
  storage?: Record<string, [number, number][]>; // container -> [itemId, count]
  events?: { spell: number; zone: number; mob: string | null; time: number }[];
  exp?: { cur: number; need: number; limit: number; merits: number; meritsMax: number; limitMode: boolean };
  weapons?: { slot: number; id: number; wsPoints: number }[]; // equipped main(0)/sub(1)/ranged(2)
  engaged?: boolean;                      // player has weapons drawn
  moves?: { actor: number; skill: number; ready: boolean; time: number }[]; // monster TP moves seen (mob_skill_id)
  logs?: Record<string, string>;            // 0x056 port -> 32 bytes hex
};

export const STALE_SECONDS = 12; // addon heartbeats every 5s

let path: Promise<string> | undefined;
const livePath = () => (path ??= appDataDir().then((d) => join(d, "live.json")));

export async function readLive(): Promise<Live | null> {
  try {
    const p = await livePath();
    if (!(await exists(p))) return null;
    return JSON.parse(await readTextFile(p)) as Live;
  } catch {
    return null; // mid-write or partial file: try again next tick
  }
}

export const isFresh = (l: Live | null): l is Live => !!l && Date.now() / 1000 - l.ts < STALE_SECONDS;

export const CONTAINERS: Record<string, string> = {
  0: "Inventory", 1: "Mog Safe", 2: "Storage", 4: "Locker", 5: "Satchel", 6: "Sack", 7: "Case",
  8: "Wardrobe", 9: "Mog Safe 2", 10: "Wardrobe 2", 11: "Wardrobe 3", 12: "Wardrobe 4",
  13: "Wardrobe 5", 14: "Wardrobe 6", 15: "Wardrobe 7", 16: "Wardrobe 8",
};

// Where each item is: itemId -> container names.
export function storageIndex(l: Live | null) {
  const m = new Map<number, string[]>();
  for (const [c, items] of Object.entries(l?.storage ?? {}))
    for (const [id] of items) m.set(id, [...(m.get(id) ?? []), CONTAINERS[c] ?? `Bag ${c}`]);
  return m;
}

// A trial weapon's weapon skill points, saved by App (user.db kv "wsTrials", by item id) so Progress can show it unequipped.
export type Trial = { points: number; need: number; ts: number };
