// Job ids follow LSB/client order (WAR=1 ... RUN=22); item jobs bitmask bit = id-1.
export const JOBS = ["war", "mnk", "whm", "blm", "rdm", "thf", "pld", "drk", "bst", "brd", "rng", "sam",
  "nin", "drg", "smn", "blu", "cor", "pup", "dnc", "sch", "geo", "run"];
export const jobName = (id: number | string) => JOBS[Number(id) - 1]?.toUpperCase() ?? "?";
export const jobMask = (job: string) => 1 << JOBS.indexOf(job);

export const LEVEL_CAP = 75; // CatseyeXI

// Equip slots: [key used by CatseyeXI API, label, item_equipment.slot bitmask]
export const SLOTS: [string, string, number][] = [
  ["main", "Main", 1], ["sub", "Sub", 2], ["ranged", "Range", 4], ["ammo", "Ammo", 8],
  ["head", "Head", 16], ["neck", "Neck", 512], ["ear1", "Ear 1", 6144], ["ear2", "Ear 2", 6144],
  ["body", "Body", 32], ["hands", "Hands", 64], ["ring1", "Ring 1", 24576], ["ring2", "Ring 2", 24576],
  ["back", "Back", 32768], ["waist", "Waist", 1024], ["legs", "Legs", 128], ["feet", "Feet", 256],
];

export const NATIONS = ["San d'Oria", "Bastok", "Windurst"];
// accountType 1 = Crystal Warrior (site hides AH/delivery for it). Other values aren't documented.
export const accountLabel = (t: number) => (t === 1 ? "Crystal Warrior" : `Standard (type ${t})`);

// LSB internal names are lowercase_with_underscores.
export const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
export const like = (s: string) => `%${s.trim().toLowerCase().replace(/\s+/g, "_")}%`;

export const DROP_TYPE: Record<number, string> = { 0: "Drop", 2: "Steal", 4: "Despoil" };
export const wikiUrl = (title: string) => `https://www.bg-wiki.com/ffxi/${encodeURIComponent(title.replace(/ /g, "_"))}`;
// Mods like ITEM_ADDEFFECT_* are server plumbing for weapon procs, not stats worth showing.
export const shownMod = (name: string) => !name.startsWith("Item ");

// Cheapest set of spells (by set points) whose trait weights reach `need`. Spells you've learned or can learn now
// are preferred; spells above your level are a last resort. Categories have <= ~12 spells, so brute force is fine.
export function solveTrait<S extends { trait_weight: number }>(cands: S[], need: number, cost: (s: S) => number): S[] | null {
  let best: S[] | null = null, bestCost = Infinity;
  const n = Math.min(cands.length, 16); // ponytail: brute force 2^n; switch to DP if a category ever exceeds 16 spells
  for (let m = 1; m < 1 << n; m++) {
    let w = 0, c = 0;
    const pick: S[] = [];
    for (let i = 0; i < n; i++) if (m & (1 << i)) { w += cands[i].trait_weight; c += cost(cands[i]); pick.push(cands[i]); }
    if (w >= need && (c < bestCost || (c === bestCost && pick.length < best!.length))) { best = pick; bestCost = c; }
  }
  return best;
}

// Map calibration (shared by the build's auto-calibration and the app's stand-here calibration).
export type Pair = { x: number; z: number; px: number; py: number };
// FFXI maps are north-up with one scale for both axes: px = s*x + b, py = -s*z + d. Sharing the scale means points
// spread along either axis are enough. Grid squares are only accurate to ~half a cell, so we demand the points span
// at least 3 cells on the map and drop outliers (wiki typos, wrong floor) while we can spare them.
export function fitMap(pairs: Pair[]) {
  const ps = pairs.slice();
  for (;;) {
    if (ps.length < 2) return null;
    const n = ps.length, mx = ps.reduce((a, q) => a + q.x, 0) / n, mz = ps.reduce((a, q) => a + q.z, 0) / n;
    const mpx = ps.reduce((a, q) => a + q.px, 0) / n, mpy = ps.reduce((a, q) => a + q.py, 0) / n;
    const den = ps.reduce((a, q) => a + (q.x - mx) ** 2 + (q.z - mz) ** 2, 0);
    if (den === 0) return null;
    const s = ps.reduce((a, q) => a + (q.x - mx) * (q.px - mpx) - (q.z - mz) * (q.py - mpy), 0) / den;
    const b = mpx - s * mx, d = mpy + s * mz;
    const res = ps.map((q) => Math.hypot(s * q.x + b - q.px, -s * q.z + d - q.py));
    const worst = res.indexOf(Math.max(...res));
    if (res[worst] > 40 && ps.length > 3) { ps.splice(worst, 1); continue; }
    const rms = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / n);
    const spreadPx = s * Math.max(Math.max(...ps.map((q) => q.x)) - Math.min(...ps.map((q) => q.x)), Math.max(...ps.map((q) => q.z)) - Math.min(...ps.map((q) => q.z)));
    if (s <= 0 || rms > 24 || spreadPx < 96) return null;
    return { a: s, b, c: -s, d, n, rms };
  }
}

// Traits a set of BLU spells activates: per category, sum the set spells' trait weights and take the highest tier
// whose points are reached.
export function activeTraits<T extends { category: number; tier: number; points: number }>(
  set: { trait_category: number | null; trait_weight: number | null }[], tiers: T[]): T[] {
  const sum = new Map<number, number>();
  for (const s of set) if (s.trait_category != null) sum.set(s.trait_category, (sum.get(s.trait_category) ?? 0) + (s.trait_weight ?? 0));
  const best = new Map<number, T>();
  for (const t of tiers) if ((sum.get(t.category) ?? 0) >= t.points && (best.get(t.category)?.tier ?? -1) < t.tier) best.set(t.category, t);
  return [...best.values()];
}

// Decode the addon's raw 0x056 quest/mission log payloads (port -> 32 bytes hex), per LandSandBoat's packets:
// quest logs are 256-bit sets indexed by quest id (offered = active, complete = done); port 0xD0 holds completed
// nation + Zilart missions (8 bytes per log); port 0xFFFF holds current missions as uint32s.
export const QUEST_AREAS = ["San d'Oria", "Bastok", "Windurst", "Jeuno", "Other Areas", "Outlands", "Aht Urhgan", "Crystal War", "Abyssea", "Adoulin", "Coalition"];
const questPort = (log: number, done: boolean) => (log <= 7 ? (done ? 0x90 : 0x50) + 8 * log : [0xe0, 0xf0, 0x100][log - 8] + (done ? 8 : 0));

export function decodeLogs(logs: Record<string, string>) {
  const bytes = (port: number) => { const h = logs[String(port)]; return h ? h.match(/../g)!.map((b) => parseInt(b, 16)) : null; };
  const bit = (b: number[], i: number) => ((b[i >> 3] ?? 0) >> (i & 7)) & 1;
  const u32 = (b: number[], o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const quests: { log: number; id: number; done: boolean }[] = [];
  for (let log = 0; log < QUEST_AREAS.length; log++) {
    const done = bytes(questPort(log, true)), active = bytes(questPort(log, false));
    // Aht Urhgan's "offered" packet reuses its last 16 bytes for mission/assault data, so only ids < 128 are quests.
    const maxActive = log === 6 ? 128 : 256;
    for (let id = 0; id < 256; id++) {
      if (done && bit(done, id)) quests.push({ log, id, done: true });
      else if (active && id < maxActive && bit(active, id)) quests.push({ log, id, done: false });
    }
  }
  const missionsDone: { log: number; id: number }[] = [];
  const md = bytes(0xd0);
  if (md) for (let log = 0; log <= 3; log++) for (let id = 0; id < 64; id++) if (bit(md, log * 64 + id)) missionsDone.push({ log, id });
  const cur = bytes(0xffff), au = bytes(0x80);
  const current = cur ? { nation: u32(cur, 0), nationMission: u32(cur, 4), zilart: u32(cur, 8), cop: u32(cur, 12),
    toau: au ? u32(au, 20) : undefined, wotg: au ? u32(au, 24) : undefined } : null;
  return { quests, missionsDone, current, have: Object.keys(logs).length > 0 };
}

// EXP/limit points gained between two addon readings. Handles level-ups (cur wraps to 0), merit rollovers
// (limit wraps at 10000 and merits go up), deaths (EXP lost: counts as 0) and spending merits. null = job changed.
export type ExpSnap = { job: number; lvl: number; cur: number; need: number; limit: number; merits: number };
export function expGain(a: ExpSnap, b: ExpSnap): number | null {
  if (a.job !== b.job) return null;
  const exp = b.lvl === a.lvl ? b.cur - a.cur : b.lvl === a.lvl + 1 ? a.need - a.cur + b.cur : 0;
  const limit = b.limit - a.limit + (b.merits > a.merits ? (b.merits - a.merits) * 10000 : 0);
  return Math.max(0, exp) + Math.max(0, limit);
}

// Skillchains. Property ids are LSB's SKILLCHAIN_ELEMENT (as stored in weapon_skills / blue_spell_list *_sc).
export const SC_NAMES = ["", "Transfixion", "Compression", "Liquefaction", "Scission", "Reverberation", "Detonation", "Induration",
  "Impaction", "Gravitation", "Distortion", "Fusion", "Fragmentation", "Light", "Darkness"];
export const SC_LEVEL = (id: number) => (id >= 13 ? 3 : id >= 9 ? 2 : 1);
// opener property -> closer property -> result (the standard skillchain table).
const SC_TABLE: Record<number, Record<number, number>> = {
  1: { 2: 2, 4: 10, 5: 5 },    // Transfixion: +Compression, +Scission = Distortion, +Reverberation
  2: { 1: 1, 6: 6 },           // Compression: +Transfixion, +Detonation
  3: { 4: 4, 8: 11 },          // Liquefaction: +Scission, +Impaction = Fusion
  4: { 3: 3, 5: 5, 6: 6 },     // Scission: +Liquefaction, +Reverberation, +Detonation
  5: { 7: 7, 8: 8 },           // Reverberation: +Induration, +Impaction
  6: { 2: 9, 4: 4 },           // Detonation: +Compression = Gravitation, +Scission
  7: { 2: 2, 5: 12, 8: 8 },    // Induration: +Compression, +Reverberation = Fragmentation, +Impaction
  8: { 3: 3, 6: 6 },           // Impaction: +Liquefaction, +Detonation
  9: { 10: 14, 12: 12 },       // Gravitation: +Distortion = Darkness, +Fragmentation
  10: { 9: 14, 11: 11 },       // Distortion: +Gravitation = Darkness, +Fusion
  11: { 9: 9, 12: 13 },        // Fusion: +Gravitation, +Fragmentation = Light
  12: { 11: 13, 10: 10 },      // Fragmentation: +Fusion = Light, +Distortion
  13: { 13: 13 },              // Light + Light
  14: { 14: 14 },              // Darkness + Darkness
};
// The skillchain an opener then a closer make (null = none). When several pairs match, the highest level wins.
export function skillchain(opener: number[], closer: number[]): number | null {
  let best: number | null = null;
  for (const o of opener) for (const c of closer) {
    const r = SC_TABLE[o]?.[c];
    if (r && (best === null || SC_LEVEL(r) > SC_LEVEL(best))) best = r;
  }
  return best;
}

// Weapon skill points one weapon skill earns on a trial weapon (LSB defaults: map.WS_POINTS_BASE 5, plus
// WS_POINTS_SKILLCHAIN 2 per level of the skillchain it closed). scMsg = the action's skillchain message, 0 if none:
// 288-289 Light/Darkness (level 3), 290-293 level 2, 294-301 level 1, 767-768 Radiance/Umbra (level 3).
export const WS_POINTS_BASE = 5, WS_POINTS_SKILLCHAIN = 2;
export function wsPoints(scMsg: number) {
  const level = scMsg >= 288 && scMsg <= 289 ? 3 : scMsg >= 290 && scMsg <= 293 ? 2 : scMsg >= 294 && scMsg <= 301 ? 1 : scMsg === 767 || scMsg === 768 ? 3 : 0;
  return WS_POINTS_BASE + level * WS_POINTS_SKILLCHAIN;
}
