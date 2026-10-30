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

// LSB (and CatseyeXI's API) store names lowercase_with_underscores and without apostrophes ("Omaern", "AlTaieu").
// nameKey matches a game or wiki name to them; App loads bg-wiki's spellings (reference.db display_names) so pretty
// shows "Om'aern" and wiki links resolve.
export const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const displayNames = new Map<string, string>();
export const setDisplayNames = (rows: { key: string; name: string }[]) => rows.forEach((r) => displayNames.set(r.key, r.name));
export const pretty = (s: string): string => {
  const job = s.match(/^(.+)_([A-Z]{3})$/); // LSB job variants: "Omaern_BST"
  if (job && displayNames.has(nameKey(job[1]))) return `${displayNames.get(nameKey(job[1]))} ${job[2]}`;
  return displayNames.get(nameKey(s)) ?? s.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
};
export const like = (s: string) => `%${s.trim().toLowerCase().replace(/'/g, "").replace(/\s+/g, "_")}%`;

export const DROP_TYPE: Record<number, string> = { 0: "Drop", 2: "Steal", 4: "Despoil" };
export const wikiUrl = (title: string) => `https://www.bg-wiki.com/ffxi/${encodeURIComponent(title.replace(/ /g, "_"))}`;
// Mods like ITEM_ADDEFFECT_* are server plumbing for weapon procs, not stats worth showing.
export const shownMod = (name: string) => !name.startsWith("Item ");

// Lowest BLU level at which a trait tier is reachable: take the category's spells lowest level first until their
// weights add up to `need`. null when even every spell falls short.
export function unlockLevel(cands: { level: number; trait_weight: number }[], need: number): number | null {
  let sum = 0;
  for (const s of [...cands].sort((a, b) => a.level - b.level)) if ((sum += s.trait_weight) >= need) return s.level;
  return null;
}

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
  // While zoning the client reports everything as 0: no gain into or out of that, or the reload counts as all your EXP.
  const unloaded = (s: ExpSnap) => !s.need || (!s.cur && !s.limit && !s.merits);
  if (unloaded(a) || unloaded(b)) return 0;
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

// Weekly conquest tally: LSB's world time_server runs it at midnight JST going into Monday = Sunday 15:00 UTC.
export function nextTally(now: number): number {
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 15) + ((7 - d.getUTCDay()) % 7) * 86400000;
  if (t <= now) t += 7 * 86400000;
  return t;
}
// Daily reset (ventures, dailies): also JST midnight, 15:00 UTC.
export function nextDaily(now: number): number {
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 15);
  return t > now ? t : t + 86400000;
}
export const dhm = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${m >= 1440 ? `${Math.floor(m / 1440)}d ` : ""}${Math.floor((m % 1440) / 60)}h ${m % 60}m`;
};

// CatseyeXI chat replies (captured by the addon). "!ventures" prints a header then lines like
// "Pool A: (10-19) Buburimu Peninsula @28%, (20-29) ..." (a zone without "@n%" has no boss progress yet), and
// "HVNM: Sauromugue Champaign (Swiftsting) @65.0%". The percentage is the zone's shared progress to its venture boss.
export type VentureTier = { pool: "A" | "B"; lo: number; hi: number; zone: string; pct: number | null };
export type Ventures = { time: number; tiers: VentureTier[]; hvnm?: { zone: string; nm: string; pct: number | null } };
export function parseVentures(lines: { text: string; time: number }[]): Ventures | null {
  const start = lines.map((l) => l.text).lastIndexOf("=== Today's Goblin Ventures ===");
  if (start < 0) return null;
  const out: Ventures = { time: lines[start].time, tiers: [] };
  let pool: "A" | "B" = "A";
  for (const { text } of lines.slice(start + 1)) {
    const hv = text.match(/^HVNM:\s*(.+?)\s*\(([^)]+)\)\s*(?:@([\d.]+)%)?/);
    if (hv) { out.hvnm = { zone: hv[1], nm: hv[2], pct: hv[3] ? +hv[3] : null }; break; }
    const p = text.match(/^Pool ([AB]):/);
    if (p) pool = p[1] as "A" | "B";
    const tiers = [...text.matchAll(/\((\d+)-(\d+)\)\s*([^,@]+?)\s*(?:@([\d.]+)%)?\s*(?:,|$)/g)];
    if (!p && !tiers.length) break; // end of the list
    for (const m of tiers) out.tiers.push({ pool, lo: +m[1], hi: +m[2], zone: m[3].trim(), pct: m[4] ? +m[4] : null });
  }
  return out;
}
// "!wspoints main" -> "...The weapon in Arcadea's main slot has 120 WS points."
export function parseWsPoints(text: string): { slot: number; points: number } | null {
  const m = text.match(/weapon in .+?'s (main|sub|ranged) slot has (\d+) WS points/i);
  return m ? { slot: ["main", "sub", "ranged"].indexOf(m[1].toLowerCase()), points: +m[2] } : null;
}

// Records of Eminence limited-time challenges: LSB scripts/globals/roe.lua timedSchedule (record ids 4008-4021 from
// roe_records.lua), one per 4-hour JST block, Sunday first.
const TIMED_NAMES: Record<number, string> = {
  4008: "Vanquish Aquans", 4009: "Vanquish Beasts", 4010: "Vanquish Plantoids", 4011: "Vanquish Lizards", 4012: "Vanquish Vermin",
  4013: "Gain Experience", 4014: "Spoils (Seals)", 4015: "Vanquish Birds", 4016: "Vanquish Amorphs", 4017: "Vanquish Undead",
  4018: "Vanquish Arcana", 4019: "Crack Treasure Caskets", 4020: "Physical Damage Kills", 4021: "Magic Damage Kills",
};
const TIMED_SCHEDULE = [
  [4021, 4010, 4016, 4012, 4018, 4013], [4015, 4011, 4017, 4014, 4019, 4008], [4016, 4012, 4018, 4013, 4020, 4009],
  [4017, 4014, 4019, 4008, 4021, 4010], [4018, 4013, 4020, 4009, 4015, 4011], [4019, 4008, 4021, 4010, 4016, 4012],
  [4020, 4009, 4015, 4011, 4017, 4014],
];
export const isTimedRoe = (name: string) => Object.values(TIMED_NAMES).includes(name);
const BLOCK = 4 * 3600_000;
// The challenge in the 4h block holding `now` (ms), with that block's start/end.
export function timedRoe(now: number): { name: string; start: number; end: number } {
  const s = Math.floor((now + 9 * 3600_000) / BLOCK) * BLOCK - 9 * 3600_000; // block start, aligned to JST hours
  const j = new Date(s + 9 * 3600_000); // its JST weekday and hour, read as UTC
  return { name: TIMED_NAMES[TIMED_SCHEDULE[j.getUTCDay()][j.getUTCHours() / 4]], start: s, end: s + BLOCK };
}
// When `name` is next active at or after `now`.
export function nextTimedRoe(name: string, now: number): number | null {
  for (let t = now; t < now + 7 * 24 * 3600_000 + BLOCK; t += BLOCK) { const b = timedRoe(t); if (b.name === name) return Math.max(b.start, now); }
  return null;
}

// Training progress from chat (the addon keeps these lines): training regimes ("You defeated a designated target.
// (Progress: 2/4)"), Records of Eminence (a "Records of Eminence: <name>." line, then "Progress: 78/200.", or both on
// one line once the addon strips the newline) and any other "(n/m)" count, keyed by its text without the numbers.
export type Count = { name: string; done: number; need: number; time: number; reward?: string };
// A regime counts each target type separately and its line doesn't say which, so the addon attaches the mob from the
// "defeats" line before it (mob). Each target seen keeps its row; when the regime begins anew they drop to 0.
// reward: the EXP (or limit points) from the latest completion, from the "gains N experience points." line after it.
export type Training = { regime?: { targets: Count[]; complete: boolean; reward?: string }; roe: Count[]; other: Count[] };
export function parseTraining(lines: { text: string; time: number; mob?: string }[]): Training {
  const roe = new Map<string, Count>(), other = new Map<string, Count>(), rewards = new Map<string, string>();
  let regime: { targets: Map<string, Count>; complete: boolean } | undefined, pending: string | undefined, rewardFor: string | undefined;
  for (const { text, time, mob } of lines) {
    let m = text.match(/gains? ([\d,]+) (experience|limit) points/i);
    if (m) { if (rewardFor) rewards.set(rewardFor, `${m[1]} ${m[2] === "experience" ? "EXP" : "limit points"}`); rewardFor = undefined; continue; }
    rewardFor = undefined;
    m = text.match(/designated target.*\(Progress: (\d+)\/(\d+)\)/i);
    if (m) {
      regime ??= { targets: new Map(), complete: false };
      regime.complete = false;
      const name = mob ?? "Designated target";
      if (mob) regime.targets.delete("Designated target"); // lines from before the addon named the mob
      regime.targets.set(name, { name, done: +m[1], need: +m[2], time });
      continue;
    }
    if (/completed (?:the|your) training regime/i.test(text)) { if (regime) regime.complete = true; rewardFor = "regime"; continue; }
    // "Your current training regime will begin anew!": same targets, counts back to 0.
    if (/regime will begin anew/i.test(text)) { regime?.targets.forEach((c) => { c.done = 0; c.time = time; }); continue; }
    // A different regime: its targets are new. (Wording guessed: "registered", "canceled".)
    if (/regime (?:registered|canceled|cancelled)/i.test(text)) { regime = undefined; rewards.delete("regime"); continue; }
    m = text.match(/completed the following Records of Eminence objective: (.+?)\.?$/);
    if (m) { const need = roe.get(m[1])?.need ?? 1; roe.set(m[1], { name: m[1], done: need, need, time }); rewardFor = `roe:${m[1]}`; continue; }
    m = text.match(/Records of Eminence: (.+?)\.?\s*(?:Progress: (\d+)\/(\d+)\.?)?$/);
    if (m) {
      pending = m[1];
      if (m[2]) { roe.set(pending, { name: pending, done: +m[2], need: +m[3], time }); pending = undefined; }
      continue;
    }
    m = text.match(/^Progress: (\d+)\/(\d+)/);
    if (m) { if (pending) roe.set(pending, { name: pending, done: +m[1], need: +m[2], time }); pending = undefined; continue; }
    m = text.match(/\((\d+)\/(\d+)\)/);
    if (m) {
      const name = text.replace(m[0], "").replace(/\s+([.!])/g, "$1").trim();
      other.set(name, { name, done: +m[1], need: +m[2], time });
    }
  }
  const newest = (a: Count, b: Count) => b.time - a.time;
  roe.forEach((c) => (c.reward = rewards.get(`roe:${c.name}`)));
  return { regime: regime && { targets: [...regime.targets.values()], complete: regime.complete, reward: rewards.get("regime") },
    roe: [...roe.values()].sort(newest), other: [...other.values()].sort(newest) };
}

// ---- FFXI macro files (USER/<id>/mcr*.dat, mcr.ttl, mcr_2.ttl) ----
// Every file: u32 version 1, u32 unknown, 16-byte MD5 of everything after the 24-byte header (the client checks it).
// mcrN.dat (N = book*10 + set, N=0 is mcr.dat): 20 macros (Ctrl 1-10 then Alt 1-10) of 380 bytes:
// u32 0, 6 lines of 61 bytes, 10-byte title. Book titles: mcr.ttl = books 1-20, mcr_2.ttl = 21-40, 16 bytes each.
// Text is Shift-JIS with auto-translate phrases as FD xx xx xx xx FD. Editing keeps it lossless with tokens:
// {AT:xxxxxxxx} for auto-translate, {hh} for any other non-ASCII byte (and "{" itself).
export const MACRO = { line: 61, lines: 6, title: 10, size: 380, count: 20, header: 24 };
export type Macro = { title: string; lines: string[] };

export function macroText(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length && b[i]; i++) {
    const c = b[i];
    if (c === 0xfd && b[i + 5] === 0xfd) {
      s += `{AT:${[...b.subarray(i + 1, i + 5)].map((x) => x.toString(16).padStart(2, "0")).join("")}}`;
      i += 5;
    } else s += c >= 0x20 && c < 0x7f && c !== 0x7b ? String.fromCharCode(c) : `{${c.toString(16).padStart(2, "0")}}`;
  }
  return s;
}

// Throws if the text has a character the macro can't hold; truncation is left to the caller's length check.
export function macroBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const m = /^\{AT:([0-9a-f]{8})\}|^\{([0-9a-f]{2})\}/i.exec(s.slice(i));
    if (m) {
      const hex = m[1] ?? m[2];
      if (m[1]) out.push(0xfd);
      for (let j = 0; j < hex.length; j += 2) out.push(parseInt(hex.slice(j, j + 2), 16));
      if (m[1]) out.push(0xfd);
      i += m[0].length - 1;
    } else {
      const c = s.charCodeAt(i);
      if (c < 0x20 || c >= 0x7f) throw new Error(`Can't use "${s[i]}" in a macro`);
      out.push(c);
    }
  }
  return out;
}

export function decodeMacros(file: Uint8Array | null): Macro[] {
  return Array.from({ length: MACRO.count }, (_, k) => {
    if (!file) return { title: "", lines: Array(MACRO.lines).fill("") };
    const o = MACRO.header + k * MACRO.size + 4;
    const lines = Array.from({ length: MACRO.lines }, (_, l) => macroText(file.subarray(o + l * MACRO.line, o + (l + 1) * MACRO.line)));
    return { title: macroText(file.subarray(o + MACRO.lines * MACRO.line, o + MACRO.lines * MACRO.line + MACRO.title)), lines };
  });
}

// Writes a field, NUL-padded; the last byte stays NUL. Throws when the text is too long.
function putField(buf: Uint8Array, at: number, len: number, s: string, what: string) {
  const b = macroBytes(s);
  if (b.length > len - 1) throw new Error(`${what} is ${b.length} bytes, max ${len - 1}`);
  buf.fill(0, at, at + len);
  buf.set(b, at);
}

// `base` keeps the header's unknown word and each macro's leading u32 from the original file.
export function encodeMacros(macros: Macro[], base: Uint8Array | null): Uint8Array {
  const buf = new Uint8Array(MACRO.header + MACRO.count * MACRO.size);
  if (base?.length === buf.length) buf.set(base);
  else buf.set([1, 0, 0, 0, 0, 0, 0x80, 0xbf]);
  macros.forEach((m, k) => {
    const o = MACRO.header + k * MACRO.size + 4;
    m.lines.forEach((l, i) => putField(buf, o + i * MACRO.line, MACRO.line, l, `Macro ${k + 1} line ${i + 1}`));
    putField(buf, o + MACRO.lines * MACRO.line, MACRO.title, m.title, `Macro ${k + 1} title`);
  });
  return sealMacroFile(buf);
}

export const decodeBookTitles = (f: Uint8Array) => Array.from({ length: 20 }, (_, i) => macroText(f.subarray(24 + i * 16, 40 + i * 16)));
export function encodeBookTitles(titles: string[], base: Uint8Array): Uint8Array {
  const buf = base.slice();
  titles.forEach((t, i) => putField(buf, 24 + i * 16, 16, t, `Book title "${t}"`));
  return sealMacroFile(buf);
}

function sealMacroFile(buf: Uint8Array) {
  buf.set(md5(buf.subarray(MACRO.header)), 8);
  return buf;
}

// Plain MD5 (RFC 1321): WebCrypto doesn't offer it.
export function md5(data: Uint8Array): Uint8Array {
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const n = ((data.length + 8) >>> 6) + 1 << 6;
  const m = new Uint8Array(n);
  m.set(data);
  m[data.length] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(n - 8, data.length * 8, true);
  dv.setUint32(n - 4, Math.floor(data.length / 2 ** 29), true);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let o = 0; o < n; o += 64) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      const r = i >> 4;
      const f = r === 0 ? (b & c) | (~b & d) : r === 1 ? (d & b) | (~d & c) : r === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = r === 0 ? i : r === 1 ? (5 * i + 1) & 15 : r === 2 ? (3 * i + 5) & 15 : (7 * i) & 15;
      const t = d;
      d = c;
      c = b;
      const x = (a + f + K[i] + dv.getUint32(o + g * 4, true)) | 0;
      const s = S[r * 4 + (i & 3)];
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0;
      a = t;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return new Uint8Array(out.buffer);
}
