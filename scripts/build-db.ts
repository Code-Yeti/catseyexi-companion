// Builds src-tauri/resources/reference.db from:
//   1. LandSandBoat sql/ dumps (LSB_SQL env, default ../FFXI-lsb/sql)
//   2. bg-wiki Category:CatsEyeXI pages (CatseyeXI-specific overrides)
//   3. data/overrides.sql (hand corrections, applied last)
// and writes data/diff-report.md (LSB vs CatseyeXI).
// Usage: node scripts/build-db.ts
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fitMap, pretty, nameKey, SC_NAMES, type Pair } from "../src/ffxi.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LSB_SQL = process.env.LSB_SQL ?? join(root, "..", "FFXI-lsb", "sql");
const OUT = join(root, "src-tauri", "resources", "reference.db");
const WIKI_API = "https://www.bg-wiki.com/api.php";
const UA = { "User-Agent": "ffxi-catseye-companion (personal tool)" };

const TABLES = [
  "zone_settings", "mob_spawn_points", "mob_groups", "mob_pools", "mob_skill_lists",
  "mob_skills", "blue_spell_list", "blue_spell_mods", "spell_list", "mob_droplist",
  "item_basic", "item_equipment", "item_mods", "item_weapon", "blue_traits", "traits", "zonelines", "npc_list", "weapon_skills",
  "mob_spell_lists",
];

// Skillchain builder: every weapon skill a Lv75 character can have (skill <= 276, plus relic and the ToAU-era mythic
// weapon skills, unlock ids 15-34) and every blue spell with skillchain properties. sc ids are LSB's SKILLCHAIN_ELEMENT.
const RELIC_WS = ["final_heaven", "mercy_stroke", "knights_of_round", "scourge", "onslaught", "metatron_torment", "catastrophe",
  "geirskogul", "blade_metsu", "tachi_kaiten", "randgrith", "gate_of_tartarus", "namas_arrow", "coronach"];
const WEAPON_TYPES: Record<number, string> = { 1: "Hand-to-Hand", 2: "Dagger", 3: "Sword", 4: "Great Sword", 5: "Axe", 6: "Great Axe",
  7: "Scythe", 8: "Polearm", 9: "Katana", 10: "Great Katana", 11: "Club", 12: "Staff", 25: "Archery", 26: "Marksmanship" };
function seedSkillchainSkills(db: DatabaseSync) {
  db.exec("CREATE TABLE sc_skills (kind TEXT, id INT, name TEXT, weapon TEXT, tag TEXT, lvl INT, sc1 INT, sc2 INT, sc3 INT, PRIMARY KEY (kind, id))");
  const ins = db.prepare("INSERT INTO sc_skills VALUES (?,?,?,?,?,?,?,?,?)");
  const ws = db.prepare("SELECT weaponskillid id, name, type, skilllevel lvl, unlock_id u, primary_sc a, secondary_sc b, tertiary_sc c FROM weapon_skills WHERE primary_sc > 0").all() as any[];
  for (const w of ws) {
    const tag = RELIC_WS.includes(w.name) ? "Relic" : w.lvl === 0 && w.u >= 15 && w.u <= 34 ? "Mythic" : w.lvl >= 1 && w.lvl <= 276 ? null : undefined;
    if (tag === undefined || !WEAPON_TYPES[w.type]) continue;
    ins.run("ws", w.id, pretty(w.name), WEAPON_TYPES[w.type], tag, w.lvl, w.a, w.b, w.c);
  }
  // blue_spell_list repeats a spellid per mob skill; the skillchain properties are the same on each row.
  const blu = db.prepare(`SELECT s.spellid id, s.name, s.level lvl, max(l.primary_sc) a, max(l.secondary_sc) b, max(l.tertiary_sc) c
    FROM blu_spells s JOIN blue_spell_list l ON l.spellid = s.spellid WHERE s.available = 1 AND l.primary_sc > 0 GROUP BY s.spellid`).all() as any[];
  for (const b of blu) ins.run("blu", b.id, b.name, "Blue Magic", null, b.lvl, b.a, b.b, b.c);
}

// ---------- MySQL dump -> SQLite ----------

const vars = new Map<string, number>();

function evalExpr(expr: string): number | null {
  const s = expr.replace(/@(\w+)/g, (_, v) => {
    v = v.toUpperCase();
    if (!vars.has(v)) throw new Error(`unknown sql var @${v}`);
    return String(vars.get(v));
  });
  if (!/^[\s\d.xa-fA-F|&+\-*()<>]+$/.test(s)) throw new Error(`bad expr: ${expr}`);
  return Function(`return (${s})`)();
}

// Splits "(a,'b',c),(d,...)" into rows of values. Handles '' and \' escapes.
function parseTuples(s: string): unknown[][] {
  const rows: unknown[][] = [];
  let row: unknown[] = [], cur = "", inStr = false, isStr = false, depth = 0;
  const push = () => {
    const t = cur.trim();
    if (isStr) row.push(cur);
    else if (t === "NULL") row.push(null);
    else if (/^0x[0-9a-f]+$/i.test(t)) row.push(t.slice(2).toUpperCase());
    else if (/^-?\d+(\.\d+)?$/.test(t)) row.push(Number(t));
    else row.push(evalExpr(t));
    cur = ""; isStr = false;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") cur += s[++i];
      else if (c === "'" && s[i + 1] === "'") { cur += "'"; i++; }
      else if (c === "'") inStr = false;
      else cur += c;
    } else if (c === "'") { inStr = true; isStr = true; }
    else if (c === "(") { if (depth++ > 0) cur += c; }
    else if (c === ")") { if (--depth > 0) cur += c; else { push(); rows.push(row); row = []; } }
    else if (c === "," && depth === 1) push();
    else if (depth > 0) cur += c;
  }
  return rows;
}

function importTable(db: DatabaseSync, table: string) {
  const src = readFileSync(join(LSB_SQL, `${table}.sql`), "utf8");
  for (const m of src.matchAll(/^\s*SET @(\w+)\s*=\s*([^;]+);/gm)) vars.set(m[1].toUpperCase(), evalExpr(m[2])!);

  const create = src.match(/CREATE TABLE[^(]*\(([\s\S]*?)\n\)/)![1];
  const cols = [...create.matchAll(/^\s*`(\w+)`/gm)].map((m) => m[1]);
  db.exec(`DROP TABLE IF EXISTS ${table}; CREATE TABLE ${table} (${cols.map((c) => `"${c}"`).join(",")});`);
  const ins = db.prepare(`INSERT INTO ${table} VALUES (${cols.map(() => "?").join(",")})`);

  let n = 0;
  // Statements may span lines; strip line comments outside strings first by taking INSERT..; chunks.
  for (const m of src.matchAll(/^INSERT INTO `\w+`(?: \([^)]*\))? VALUES\s*([\s\S]*?\));\s*(?:--[^\n]*)?$/gm)) {
    for (const r of parseTuples(m[1])) {
      if (r.length !== cols.length) throw new Error(`${table}: ${r.length} values for ${cols.length} cols`);
      ins.run(...(r as any[]));
      n++;
    }
  }
  return n;
}

// ---------- bg-wiki ----------

async function wikiText(page: string): Promise<string> {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
  const j: any = await (await fetch(url, { headers: UA })).json();
  if (!j.parse) throw new Error(`wiki page missing: ${page}`);
  return j.parse.wikitext["*"];
}

const links = (s: string) => [...s.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map((m) => (m[2] ?? m[1]).trim());
const plain = (s: string) =>
  s.replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, "$1").replace(/\{\{[^}]*\}\}/g, "").replace(/'''?/g, "").trim();

// Returns rows of raw cell wikitext for every {| ... |} table in `text`.
function wikiTables(text: string): string[][][] {
  const clean = text.replace(/<!--[\s\S]*?-->/g, "");
  return [...clean.matchAll(/\{\|([\s\S]*?)\n\|\}/g)].map((t) =>
    t[1].split(/\n\|-[^\n]*/).slice(1).map((row) =>
      row.split("\n").filter((l) => l.startsWith("|") && !l.startsWith("|}"))
        .map((l) => l.slice(1).replace(/^\s*(?:[a-z-]+="[^"]*"\s*)+\|/i, "").trim()),
    ).filter((r) => r.length),
  );
}

// ---------- main ----------

async function main() {
  assert(existsSync(LSB_SQL), `LSB sql dir not found: ${LSB_SQL} (set LSB_SQL)`);
  mkdirSync(dirname(OUT), { recursive: true });
  rmSync(OUT, { force: true });
  const db = new DatabaseSync(OUT);
  db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;");

  db.exec("BEGIN");
  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = importTable(db, t);
  db.exec("COMMIT");
  console.log("LSB rows:", counts);

  // Item/gear mod id -> display name, from LSB's mod enum (values: `  name: id  # comment`).
  db.exec("CREATE TABLE mod_names (id INTEGER PRIMARY KEY, name TEXT)");
  const insMod = db.prepare("INSERT OR IGNORE INTO mod_names VALUES (?,?)");
  const modYaml = readFileSync(join(LSB_SQL, "..", "data", "enums", "mod.yaml"), "utf8");
  for (const m of modYaml.matchAll(/^ {2}(\w+):\s+(\d+)/gm))
    insMod.run(Number(m[2]), m[1].length <= 4 ? m[1].toUpperCase() : m[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));

  // CatseyeXI overrides from bg-wiki
  db.exec(`CREATE TABLE cx_blu_spells (name TEXT PRIMARY KEY, level INT, notes TEXT, notes_wiki TEXT, links TEXT);
           CREATE TABLE cx_pages (page TEXT PRIMARY KEY, title TEXT);`);
  const jobs = await wikiText("CatsEyeXI_Systems/Jobs");
  const blu = jobs.slice(jobs.indexOf("== Blue Mage =="), jobs.indexOf("\n==Corsair") > 0 ? jobs.indexOf("\n==Corsair") : undefined);
  const insBlu = db.prepare("INSERT OR REPLACE INTO cx_blu_spells VALUES (?,?,?,?,?)");
  for (const table of wikiTables(blu))
    for (const [spell, level, notes = ""] of table)
      if (/^\d+$/.test(level)) insBlu.run(plain(spell), Number(level), plain(notes), notes, JSON.stringify(links(notes)));
  db.exec("CREATE TABLE cx_text (key TEXT PRIMARY KEY, wikitext TEXT)");
  db.prepare("INSERT INTO cx_text VALUES (?,?)").run("blu_adjustments", blu.split("=== Spells ===")[0]);

  // Index of every CatsEyeXI wiki page, for "see wiki" links in the UI.
  const cat: any = await (await fetch(
    `${WIKI_API}?action=query&list=categorymembers&cmtitle=Category:CatsEyeXI&cmlimit=500&format=json`, { headers: UA })).json();
  const insPage = db.prepare("INSERT OR REPLACE INTO cx_pages VALUES (?,?)");
  for (const m of cat.query.categorymembers) insPage.run(m.title.replace(/ /g, "_"), m.title);

  seedQuestNames(db); // before seedChecklists, which builds the mission lists from mission_names
  seedMerits(db);
  await seedChecklists(db);
  await seedMaps(db);
  await seedDisplayNames(db); // before VIEWS: the zones view uses it
  db.exec(VIEWS);

  const overrides = join(root, "data", "overrides.sql");
  if (existsSync(overrides)) db.exec(readFileSync(overrides, "utf8"));

  db.exec("VACUUM");
  diffReport(db);
  await seedBluInfo(db);

  // One row per mob per zone for the sortable Mobs table (needs blu_spells from diffReport).
  db.exec(`
    CREATE TABLE mob_index AS
    SELECT s.mobname, coalesce((SELECT d.name FROM display_names d WHERE d.key = replace(lower(s.mobname), '_', '')), replace(s.mobname,'_',' ')) AS name, s.zoneid, z.name AS zone, min(s.minLevel) AS lo, max(s.maxLevel) AS hi,
           count(*) AS n, max(s.respawntime) AS respawn, max(p.aggro) AS aggro, max(p.links) AS links, max(p.true_detection) AS truesight,
           max(s.skill_list_id) AS skill_list_id, max(s.poolid) AS poolid, NULL AS family, NULL AS blu,
           NULL AS cx_lo, NULL AS cx_hi, 0 AS era
    FROM spawns s JOIN mob_pools p ON p.poolid = s.poolid LEFT JOIN zones z ON z.zoneid = s.zoneid
    GROUP BY s.mobname, s.zoneid;
    UPDATE mob_index SET
      family = (SELECT skill_list_name FROM mob_skill_lists sl WHERE sl.skill_list_id = mob_index.skill_list_id LIMIT 1),
      blu = (SELECT group_concat(name, ', ') FROM (SELECT DISTINCT b.name FROM blu_spell_skills bs JOIN blu_spells b USING (spellid)
             JOIN mob_skill_lists sl ON sl.mob_skill_id = bs.mob_skill_id WHERE sl.skill_list_id = mob_index.skill_list_id AND b.available = 1));
    CREATE INDEX ix_mi_zone ON mob_index(zoneid);
    CREATE INDEX ix_mi_name ON mob_index(mobname, zoneid);`);
  seedStatusRisk(db);
  seedRegimes(db);
  seedSkillchainSkills(db);
  await seedTrusts(db);
  await seedCxLevels(db);
  selfCheck(db);
  db.close();
  console.log("wrote", OUT);
}

// Progress checklists: CatsEyeXI custom quests + mission lists built from LSB's mission ids (mission_names), so the
// app can tick them from the game's mission log. [list, LSB log id]
const MISSION_LISTS: [string, number][] = [
  ["San d'Oria Missions", 0], ["Bastok Missions", 1], ["Windurst Missions", 2], ["Zilart Missions", 3],
  ["Promathia Missions", 6], ["Aht Urhgan Missions", 4], ["Wings of the Goddess Missions", 5],
];
// Nation missions: the 20 numbered missions, once the rank-2 travel legs to the other nations are left out.
const NATION_LEG = /^(Journey To |The Emissary |The Three Kingdoms )/;
const NATION_NUMBERS = ["1-1", "1-2", "1-3", "2-1", "2-2", "2-3", "3-1", "3-2", "3-3", "4-1", "5-1", "5-2", "6-1", "6-2", "7-1", "7-2", "8-1", "8-2", "9-1", "9-2"];

// ---------- zone maps (bg-wiki) + auto-calibration ----------
// bg-wiki zone pages carry "Zone Geography" rows: for each connection, the map file + grid square (e.g. G-7) of the
// exit on this zone's map and of the arrival on the neighbour's map. LSB zonelines has the exact from/to coordinates
// of those same connections, so each row yields (game x,z) <-> (map px) pairs and we fit px = a*x+b, py = c*z+d per map.
// Images are NOT bundled (Square Enix maps with fan annotations); the app downloads them to the user's AppData on demand.

const GRID = (i: number, size: number) => ((36 + 32 * i) * size) / 512; // centre of grid cell i on a standard 512px map

async function wikiQuery(params: Record<string, string>) {
  const url = `${WIKI_API}?${new URLSearchParams({ format: "json", ...params })}`;
  return (await fetch(url, { headers: UA })).json() as Promise<any>;
}

// ---------- CatseyeXI levels for post-Adoulin zone ids ----------
// CatseyeXI's DB holds every retail zone, but only some ids >= 256 are real content there, re-levelled for the 75 cap
// (Escha - Zi'Tah's mobs are 50s-80s on CatseyeXI vs 107+ in LSB). We probe each such zone with one search, and for
// zones within reach fetch CatseyeXI's levels for all their mobs (search ids are LSB pool ids). Responses are cached in
// data/cx-cache.json so rebuilds don't hit the site; delete it to refresh. Zones < 256 keep LSB levels (the Mob page
// still shows the live CatseyeXI level per mob).
const REACH = 85; // highest mob min-level still worth showing at the 75 cap (gives EXP, can teach blue magic)

async function seedCxLevels(db: DatabaseSync) {
  const cachePath = join(root, "data", "cx-cache.json");
  const cache: Record<string, any[]> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  let fetched = 0;
  const search = async (q: string) => {
    if (!(q in cache)) {
      const j: any = await (await fetch(`https://catseyexi.com/api/search/mobs?q=${encodeURIComponent(q)}&limit=500`, { headers: UA })).json();
      cache[q] = (j.mobs ?? []).map((m: any) => ({ id: m.mobid, lo: m.minLevel, hi: m.maxLevel }));
      fetched++;
      await new Promise((r) => setTimeout(r, 400)); // be polite
    }
    return cache[q];
  };

  db.exec("CREATE TABLE cx_pool_levels (poolid INTEGER PRIMARY KEY, lo INT, hi INT); CREATE TABLE cx_zones (zoneid INTEGER PRIMARY KEY)");
  const insLvl = db.prepare("INSERT OR REPLACE INTO cx_pool_levels VALUES (?,?,?)");
  const zones = db.prepare("SELECT DISTINCT zoneid FROM mob_index WHERE zoneid >= 256 AND hi > 1").all() as any[];
  for (const { zoneid } of zones) {
    const mobs = db.prepare("SELECT mobname, poolid, n FROM mob_index WHERE zoneid = ? AND hi > 1 ORDER BY n DESC").all(zoneid) as any[];
    const pools = new Set(mobs.map((m) => m.poolid));
    const probe = (await search(mobs[0].mobname)).find((m) => pools.has(m.id));
    if (!probe || probe.lo == null || probe.lo > REACH) continue;
    db.prepare("INSERT INTO cx_zones VALUES (?)").run(zoneid);
    // Cover the zone's names with as few substring queries as possible (shared tokens like "Eschan").
    const left = new Set(mobs.map((m) => m.mobname as string));
    while (left.size) {
      const cnt = new Map<string, number>();
      for (const n of left) for (const t of new Set(n.split("_").filter((t) => t.length >= 3))) cnt.set(t, (cnt.get(t) ?? 0) + 1);
      const best = [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0] ?? [...left][0];
      for (const m of await search(best)) if (pools.has(m.id) && m.lo != null) insLvl.run(m.id, m.lo, m.hi);
      for (const n of [...left]) if (n.includes(best)) left.delete(n);
      left.delete(best);
    }
  }
  writeFileSync(cachePath, JSON.stringify(cache));

  // Effective levels + "era" flag (on CatseyeXI and within reach) used by the Mobs and Blue Magic pages.
  db.exec(`
    UPDATE mob_index SET cx_lo = (SELECT lo FROM cx_pool_levels c WHERE c.poolid = mob_index.poolid),
                         cx_hi = (SELECT hi FROM cx_pool_levels c WHERE c.poolid = mob_index.poolid);
    UPDATE mob_index SET era = (hi > 1 AND (zoneid < 256 OR zoneid IN (SELECT zoneid FROM cx_zones)) AND coalesce(cx_lo, lo) <= ${REACH});`);
  const z = db.prepare("SELECT group_concat(z.name, ', ') n FROM cx_zones c JOIN zones z USING (zoneid)").get() as any;
  console.log(`CatseyeXI levels: ${fetched} new requests; zones >= 256 on CatseyeXI: ${z.n}`);
}

// LSB names drop apostrophes ("Omaern", "AlTaieu"). bg-wiki's page titles keep them: every Bestiary and Areas title
// with an apostrophe, keyed like ffxi.ts nameKey (lowercase, letters and digits only).
async function seedDisplayNames(db: DatabaseSync) {
  db.exec("CREATE TABLE display_names (key TEXT PRIMARY KEY, name TEXT)");
  const ins = db.prepare("INSERT OR IGNORE INTO display_names VALUES (?,?)");
  for (const cat of ["Category:Areas", "Category:Bestiary"])
    for (let cont: any = {}; ;) {
      const j = await wikiQuery({ action: "query", list: "categorymembers", cmtitle: cat, cmlimit: "500", cmtype: "page", ...cont });
      for (const { title } of j.query.categorymembers as { title: string }[]) {
        const name = title.replace(/\s*\(.*\)$/, ""); // "Foo (Zone)" disambiguation
        if (name.includes("'")) ins.run(nameKey(name), name);
      }
      if (!j.continue) break;
      cont = j.continue;
    }
  console.log(`display names: ${(db.prepare("SELECT count(*) c FROM display_names").get() as any).c}`);
}

async function seedMaps(db: DatabaseSync) {
  const norm = (s: string) => s.toLowerCase().replace(/[[(]s[\])]/g, "s").replace(/[^a-z0-9]/g, "");
  const zoneByKey = new Map((db.prepare("SELECT zoneid, name FROM zone_settings").all() as any[]).map((z) => [norm(z.name), z.zoneid as number]));
  const fileKey = (f: string) => f.trim().replace(/ /g, "_");

  const titles: string[] = [];
  for (let cont: any = {}; ;) {
    const j = await wikiQuery({ action: "query", list: "categorymembers", cmtitle: "Category:Areas", cmlimit: "500", cmtype: "page", ...cont });
    titles.push(...j.query.categorymembers.map((m: any) => m.title));
    if (!j.continue) break;
    cont = j.continue;
  }

  // Three things per zone page: its map list ("Zone Map" rows, in floor order), zone connections ("Zone Geography"
  // rows, two template styles), and NPC/Survival Guide positions as grid squares on a numbered map.
  type Geo = { zone: number; nb: number; ownMap: string; ownPos: string; nbMap: string; nbPos: string };
  const geo: Geo[] = [];
  const zoneMaps = new Map<number, { file: string; label: string }[]>();
  const npcs: { zone: number; name: string; map: number; file?: string; pos: string }[] = [];
  const field = (b: string, ...ks: string[]) => { for (const k of ks) { const m = b.match(new RegExp(`\\|\\s*${k}\\s*=\\s*([^|\\n}]*)`)); if (m?.[1].trim()) return m[1].trim(); } return ""; };
  for (let i = 0; i < titles.length; i += 50) {
    const j = await wikiQuery({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: titles.slice(i, i + 50).join("|") });
    for (const p of Object.values(j.query.pages) as any[]) {
      const zone = zoneByKey.get(norm(p.title));
      const text: string | undefined = p.revisions?.[0]?.slots?.main?.["*"];
      if (zone === undefined || !text) continue;
      for (const m of text.matchAll(/\{\{Zone Geography Row[^|]*([\s\S]*?)\n\}\}/g)) {
        const b = m[1];
        geo.push({
          zone, nb: zoneByKey.get(norm(field(b, "Geography\\.Zone", "Connected Zone"))) ?? -1,
          ownMap: field(b, "Geography\\.Entrance_Map", "Current Zone Exit Map"), ownPos: field(b, "Geography\\.Entrance_Position", "Current Zone Exit Position"),
          nbMap: field(b, "Geography\\.Exit_Map", "Connected Zone Entrance Map"), nbPos: field(b, "Geography\\.Exit_Position", "Connected Zone Entrance Position"),
        });
      }
      const maps = [...text.matchAll(/\{\{Zone Map\s*\n([\s\S]*?)\n\}\}/g)]
        .map((m) => ({ file: fileKey(field(m[1], "Map")), label: field(m[1], "Map Text") || "Map" })).filter((m) => m.file);
      if (maps.length) zoneMaps.set(zone, maps);
      for (const m of text.matchAll(/\{\{Zone NPC Row([\s\S]*?)\n\}\}/g))
        npcs.push({ zone, name: plain(field(m[1], "NPC\\.Name")), map: Number(field(m[1], "NPC\\.Map")) || 1, pos: field(m[1], "NPC\\.Position") });
      for (const m of text.matchAll(/\{\{Zone Quick Travel Row([\s\S]*?)\n\}\}/g))
        if (/survival guide/i.test(field(m[1], "Travel Option")))
          npcs.push({ zone, name: "Survival Guide", map: Number(field(m[1], "Map Number")) || 1, file: fileKey(field(m[1], "Travel Map")), pos: field(m[1], "Zone Position") });
    }
  }

  // Map list per zone: the page's own Zone Map table; otherwise files named after the zone in geography rows.
  // A file belongs to the zone whose name is its longest prefix, so "East_Ronfaure_(S)_Map" isn't given to East Ronfaure.
  const keys = [...zoneByKey.keys()].sort((a, b) => b.length - a.length);
  const owner = (f: string) => { const n = norm(f.replace(/\.\w+$/, "")); const k = keys.find((k) => n.startsWith(k)); return k === undefined ? undefined : zoneByKey.get(k); };
  for (const r of geo)
    for (const [z, f] of [[r.zone, r.ownMap], [r.nb, r.nbMap]] as [number, string][]) {
      if (z < 0) continue;
      const k = fileKey(f);
      if (!/\.(jpe?g|png|gif)$/i.test(k) || /no_map/i.test(k) || owner(k) !== z) continue;
      const list = zoneMaps.get(z) ?? [];
      if (!list.some((m) => m.file === k)) zoneMaps.set(z, [...list, { file: k, label: "Map" }]);
    }

  const all = [...new Set([...zoneMaps.values()].flat().map((m) => m.file))];
  const info = new Map<string, { url: string; w: number; h: number }>();
  for (let i = 0; i < all.length; i += 50) {
    const j = await wikiQuery({ action: "query", prop: "imageinfo", iiprop: "url|size", titles: all.slice(i, i + 50).map((f) => `File:${f}`).join("|") });
    for (const p of Object.values(j.query.pages) as any[]) {
      const ii = p.imageinfo?.[0];
      if (ii) info.set(fileKey(p.title.replace(/^File:/, "")), { url: ii.url, w: ii.width, h: ii.height });
    }
  }

  // Calibration pairs per map file.
  const cell = (pos: string, f: string) => {
    const m = pos.match(/([A-P])\s*-\s*(\d{1,2})/i), im = info.get(fileKey(f));
    return m && im ? { px: GRID(m[1].toUpperCase().charCodeAt(0) - 65, im.w), py: GRID(+m[2] - 1, im.h) } : null;
  };
  const pairs = new Map<string, Pair[]>();
  const ambiguous: { file: string; c: { px: number; py: number }; opts: { x: number; z: number }[] }[] = [];
  const addPair = (f: string, x: number, z: number, c: { px: number; py: number } | null) => {
    if (c) pairs.set(fileKey(f), [...(pairs.get(fileKey(f)) ?? []), { x, z, ...c }]);
  };

  const zl = db.prepare("SELECT from_pos_x fx, from_pos_z fz, to_pos_x tx, to_pos_z tz FROM zonelines WHERE from_zone=? AND to_zone=?");
  for (const r of geo) {
    if (r.nb < 0) continue;
    const lines = zl.all(r.zone, r.nb) as any[];
    const own = cell(r.ownPos, r.ownMap), arr = cell(r.nbPos, r.nbMap);
    if (lines.length === 1) {
      addPair(r.ownMap, lines[0].fx, lines[0].fz, own); // the exit, in this zone
      addPair(r.nbMap, lines[0].tx, lines[0].tz, arr);  // the arrival, in the neighbour
    } else if (lines.length > 1) {
      if (own) ambiguous.push({ file: fileKey(r.ownMap), c: own, opts: lines.map((l) => ({ x: l.fx, z: l.fz })) });
      if (arr) ambiguous.push({ file: fileKey(r.nbMap), c: arr, opts: lines.map((l) => ({ x: l.tx, z: l.tz })) });
    }
  }

  const npcPos = db.prepare("SELECT pos_x x, pos_z z FROM npc_list WHERE ((npcid >> 12) & 4095) = ? AND (lower(polutils_name) = ? OR lower(replace(name,'_',' ')) = ?) AND (pos_x != 0 OR pos_z != 0)");
  for (const n of npcs) {
    const file = n.file || zoneMaps.get(n.zone)?.[n.map - 1]?.file;
    if (!file) continue;
    const hits = npcPos.all(n.zone, n.name.toLowerCase(), n.name.toLowerCase()) as any[];
    if (hits.length === 1) addPair(file, hits[0].x, hits[0].z, cell(n.pos, file)); // unique NPCs only; "Home Point #1" etc. are ambiguous
  }

  // Ambiguous connections (several zonelines between the same two zones): once a map has a fit, take the option
  // that lands nearest its grid square, if it's within a cell.
  for (const amb of ambiguous) {
    const fit = fitMap(pairs.get(amb.file) ?? []);
    if (!fit) continue;
    const dist = (o: { x: number; z: number }) => Math.hypot(fit.a * o.x + fit.b - amb.c.px, fit.c * o.z + fit.d - amb.c.py);
    const best = amb.opts.reduce((a, o) => (dist(o) < dist(a) ? o : a));
    if (dist(best) < 32) addPair(amb.file, best.x, best.z, amb.c);
  }

  // Raw pairs kept for debugging calibration (small).
  db.exec("CREATE TABLE zone_map_pairs (file TEXT, x REAL, z REAL, px REAL, py REAL)");
  const insP = db.prepare("INSERT INTO zone_map_pairs VALUES (?,?,?,?,?)");
  for (const [f, ps] of pairs) for (const q of ps) insP.run(f, q.x, q.z, q.px, q.py);
  db.exec("CREATE TABLE zone_maps (zoneid INT, file TEXT, label TEXT, url TEXT, w INT, h INT, ord INT, a REAL, b REAL, c REAL, d REAL, n INT, rms REAL)");
  const ins = db.prepare("INSERT INTO zone_maps VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  let calibrated = 0, total = 0;
  for (const [zone, list] of zoneMaps) {
    list.filter((m) => info.has(m.file)).forEach((m, i) => {
      const im = info.get(m.file)!, fit = fitMap(pairs.get(m.file) ?? []);
      ins.run(zone, m.file, m.label, im.url, im.w, im.h, i, fit?.a ?? null, fit?.b ?? null, fit?.c ?? null, fit?.d ?? null, fit?.n ?? 0, fit?.rms ?? null);
      total++; if (fit) calibrated++;
    });
  }
  console.log(`maps: ${total} files for ${zoneMaps.size} zones, ${calibrated} auto-calibrated (${npcs.length} wiki NPC positions, ${ambiguous.length} ambiguous exits)`);
}

// ---------- quest / mission ids (for decoding the addon's 0x056 quest log packets) ----------
// LSB's scripts/globals/quests.lua and missions.lua list NAME = id per log, in blocks keyed by the log enum.
// Read straight from the pinned LSB commit with git, so the sparse checkout doesn't need scripts/.
const QUEST_LOGS: Record<string, number> = { SANDORIA: 0, BASTOK: 1, WINDURST: 2, JEUNO: 3, OTHER_AREAS: 4, OUTLANDS: 5,
  AHT_URHGAN: 6, CRYSTAL_WAR: 7, ABYSSEA: 8, ADOULIN: 9, COALITION: 10 };
const MISSION_LOGS: Record<string, number> = { SANDORIA: 0, BASTOK: 1, WINDURST: 2, ZILART: 3, TOAU: 4, WOTG: 5, COP: 6 };

// What each blue spell does, for the Spells list: the header comment of its LSB script (description, monster family,
// physical/magical type, duration), plus MP/cast/recast from spell_list, set stats from blue_spell_mods and skillchain
// properties from blue_spell_list.
async function seedBluInfo(db: DatabaseSync) {
  const lsb = join(LSB_SQL, "..");
  const git = (...a: string[]) => execFileSync("git", ["-C", lsb, ...a], { encoding: "utf8", maxBuffer: 1 << 26 });
  for (const c of ["description TEXT", "family TEXT", "spell_type TEXT", "duration TEXT", "mp INT", "cast_time REAL", "recast_time REAL", "stats TEXT", "sc TEXT", "trait TEXT"])
    db.exec(`ALTER TABLE blu_spells ADD COLUMN ${c}`);
  const files = new Set(git("ls-tree", "--name-only", "HEAD", "scripts/actions/spells/blue/").split(/\r?\n/));
  const upd = db.prepare("UPDATE blu_spells SET description=?, family=?, spell_type=?, duration=?, mp=?, cast_time=?, recast_time=?, stats=?, sc=? WHERE spellid=?");
  let described = 0;
  for (const r of db.prepare(`SELECT s.spellid, s.name, s.mpCost, s.castTime, s.recastTime, b.primary_sc, b.secondary_sc, b.tertiary_sc,
      (SELECT group_concat(n.name || CASE WHEN m.value > 0 THEN '+' ELSE '' END || CAST(m.value AS INT), ', ') FROM blue_spell_mods m
       JOIN mod_names n ON n.id = m.modid WHERE m.spellid = s.spellid AND m.modid > 0) stats
      FROM spell_list s JOIN blue_spell_list b ON b.spellid = s.spellid GROUP BY s.spellid`).all() as any[]) {
    const f = `scripts/actions/spells/blue/${r.name}.lua`;
    const h: Record<string, string> = {}, desc: string[] = [];
    if (files.has(f)) {
      for (const line of git("show", `HEAD:${f}`).split(/\r?\n/).slice(1, 25)) {
        if (!line.startsWith("-- ")) continue;
        const t = line.slice(3).trim();
        // Description: every line between "Spell:" and "Spell cost:" (it can itself look like "Additional effect: ...").
        if (h.spell && !h["spell cost"] && !/^Spell cost:/i.test(t)) { desc.push(t); continue; }
        const kv = t.match(/^([A-Za-z ()]+):\s*(.*)$/);
        if (kv) h[kv[1].toLowerCase()] = kv[2].replace(/^[A-Za-z ]+:\s*/, "").trim(); // "Casting Time: Casting Time: 3 seconds"
      }
      if (desc.length) described++;
    }
    const sc = [r.primary_sc, r.secondary_sc, r.tertiary_sc].filter((x) => x > 0).map((x) => SC_NAMES[x]).join(", ");
    upd.run(desc.join(" ") || null, h["monster type"] ?? null, h["spell type"] ?? null, h.duration ?? null, r.mpCost, r.castTime / 1000, r.recastTime / 1000, r.stats, sc || null, r.spellid);
  }
  db.exec("UPDATE blu_spells SET trait = (SELECT name FROM blu_trait_tiers t WHERE t.category = blu_spells.trait_category LIMIT 1)");
  // Spells with no LSB script (later retail spells CatseyeXI moved down, and CatseyeXI-only ones): bg-wiki's
  // {{Blue Magic}} template, one batched request. Only fills what LSB left empty.
  const missing = db.prepare("SELECT spellid, name FROM blu_spells WHERE available = 1 AND description IS NULL").all() as any[];
  const field = (b: string, k: string) => b.match(new RegExp(`\\|${k}=([^\\n]*)`))?.[1].replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/<br ?\/?>/g, ", ").trim() || null;
  const fill = db.prepare(`UPDATE blu_spells SET description = ?, spell_type = coalesce(spell_type, ?), family = coalesce(family, ?), duration = coalesce(duration, ?),
    mp = coalesce(mp, ?), cast_time = coalesce(cast_time, ?), recast_time = coalesce(recast_time, ?), stats = coalesce(stats, ?), trait = coalesce(trait, ?) WHERE spellid = ?`);
  const byName = new Map(missing.map((r) => [norm(r.name), r.spellid]));
  for (let i = 0; i < missing.length; i += 50) {
    const j = await wikiQuery({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", redirects: "1", titles: missing.slice(i, i + 50).map((r) => r.name).join("|") });
    const alias = new Map<string, string>(((j.query.redirects ?? []) as any[]).map((r) => [r.to, r.from]));
    for (const p of Object.values(j.query.pages) as any[]) {
      const b = p.revisions?.[0]?.slots?.main?.["*"]?.match(/\{\{Blue Magic([\s\S]*?)\n\}\}/)?.[1];
      const id = byName.get(norm(alias.get(p.title) ?? p.title));
      if (!b || id === undefined) continue;
      const num = (k: string) => { const v = field(b, k)?.match(/[\d.]+/)?.[0]; return v ? Number(v) : null; };
      const type = [field(b, "type"), field(b, "damage")].filter(Boolean);
      fill.run(field(b, "desc"), type.length ? `${type[0]}${type[1] ? ` (${type[1]})` : ""}` : null, field(b, "mtype"), field(b, "duration"),
        num("mp"), num("cast"), num("recast"), field(b, "stats")?.replace(/\s*([+-])\s*/g, "$1").replace(/(\d)\s+(?=[A-Z])/g, "$1, ") ?? null, field(b, "trait"), id);
      described++;
    }
  }
  console.log(`blue spell descriptions: ${described} (${missing.length} looked up on bg-wiki)`);
}

function seedQuestNames(db: DatabaseSync) {
  const lsb = join(LSB_SQL, "..");
  const show = (f: string) => execFileSync("git", ["-C", lsb, "show", `HEAD:${f}`], { encoding: "utf8", maxBuffer: 1 << 26 });
  db.exec("CREATE TABLE quest_names (log INT, id INT, name TEXT, PRIMARY KEY (log, id)); CREATE TABLE mission_names (log INT, id INT, name TEXT, PRIMARY KEY (log, id))");
  const parse = (text: string, table: string, logs: Record<string, number>, block: RegExp) => {
    const ins = db.prepare(`INSERT OR IGNORE INTO ${table} VALUES (?,?,?)`);
    let log: number | undefined, n = 0;
    for (const line of text.split(/\r?\n/)) {
      const b = line.match(block);
      if (b) { log = logs[b[1]]; continue; }
      if (/^    \},?\s*$/.test(line)) { log = undefined; continue; } // end of a log's block
      const m = line.match(/^\s+([A-Z0-9_]+)\s*=\s*(\d+)\s*,/);
      if (m && log !== undefined) { ins.run(log, Number(m[2]), m[1].replace(/_/g, " ").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())); n++; }
    }
    return n;
  };
  const q = parse(show("scripts/globals/quests.lua"), "quest_names", QUEST_LOGS, /\[xi\.quest\.area\[xi\.questLog\.([A-Z_]+)\]\]/);
  const m = parse(show("scripts/globals/missions.lua"), "mission_names", MISSION_LOGS, /\[xi\.mission\.area\[xi\.mission\.log_id\.([A-Z_]+)\]\]/);
  console.log(`quest names: ${q}, mission names: ${m}`);
}

async function seedChecklists(db: DatabaseSync) {
  // log/mid: the LSB mission this row is (null for custom quests), used to tick it from the game's mission log.
  db.exec("CREATE TABLE checklist_seed (list TEXT, item TEXT, note TEXT, url TEXT, ord INT, log INT, mid INT, PRIMARY KEY (list, item))");
  const ins = db.prepare("INSERT OR IGNORE INTO checklist_seed VALUES (?,?,?,?,?,?,?)");
  const wiki = (t: string) => `https://www.bg-wiki.com/ffxi/${encodeURIComponent(t.replace(/ /g, "_"))}`;

  const quests = await wikiText("CatsEyeXI_Systems/Quests");
  let ord = 0;
  for (const block of quests.split("{{CatsEyeXI Quests").slice(1)) {
    const f = (k: string) => block.match(new RegExp(`\\|\\s*${k}\\s*=\\s*([^|\\n]*)`))?.[1].trim() ?? "";
    const name = plain(f("Quest Name"));
    if (!name) continue;
    const modes = ["ACE", "CW", "WEW"].filter((m) => /^y/i.test(f(m))).join("/");
    const note = [plain(f("Zone")), f("Level Requirement") && `Lv${plain(f("Level Requirement"))}`, f("Job") && plain(f("Job")), modes].filter(Boolean).join(" · ");
    ins.run("CatsEyeXI Quests", name, note, wiki("CatsEyeXI_Systems/Quests"), ord++, null, null);
  }

  const search = (t: string) => `https://www.bg-wiki.com/index.php?search=${encodeURIComponent(t)}`;
  for (const [list, log] of MISSION_LISTS) {
    let ms = db.prepare("SELECT id, name FROM mission_names WHERE log=? AND id<>65535 ORDER BY id").all(log) as { id: number; name: string }[];
    if (log <= 2) ms = ms.filter((m) => !NATION_LEG.test(m.name));
    if (log <= 2) assert.equal(ms.length, NATION_NUMBERS.length, `${list}: expected 20 numbered missions`);
    ms.forEach((m, i) => ins.run(list, `${log <= 2 ? NATION_NUMBERS[i] : `${i + 1}.`} ${m.name}`, null, search(m.name), i, log, m.id));
  }
}

// Derived views the app queries. Zone of a spawn = (mobid >> 12) & 0xFFF.
const VIEWS = `
CREATE INDEX ix_sp_group ON mob_spawn_points(groupid);
CREATE INDEX ix_g_pool ON mob_groups(poolid);
CREATE INDEX ix_g_group ON mob_groups(groupid, zoneid);
CREATE INDEX ix_g_drop ON mob_groups(dropid);
CREATE INDEX ix_sp_name ON mob_spawn_points(mobname);
CREATE INDEX ix_p_pool ON mob_pools(poolid);
CREATE INDEX ix_sl_list ON mob_skill_lists(skill_list_id);
CREATE INDEX ix_bl_spell ON blue_spell_list(spellid);
CREATE INDEX ix_item ON item_basic(itemid);
CREATE INDEX ix_spell ON spell_list(spellid);
CREATE INDEX ix_sl_skill ON mob_skill_lists(mob_skill_id);
CREATE INDEX ix_p_skilllist ON mob_pools(skill_list_id);
CREATE INDEX ix_drop ON mob_droplist(dropId);
CREATE INDEX ix_drop_item ON mob_droplist(itemId);
CREATE INDEX ix_mods ON item_mods(itemId);

CREATE VIEW spawns AS
SELECT sp.mobid, sp.mobname, replace(sp.mobname,'_',' ') AS name, sp.minLevel, sp.maxLevel,
       sp.pos_x AS x, sp.pos_y AS y, sp.pos_z AS z, (sp.mobid >> 12) & 4095 AS zoneid,
       g.groupid, g.poolid, g.dropid, g.respawntime, g.spawntype, p.skill_list_id
FROM mob_spawn_points sp
JOIN mob_groups g ON g.groupid = sp.groupid AND g.zoneid = (sp.mobid >> 12) & 4095
JOIN mob_pools p ON p.poolid = g.poolid;

CREATE VIEW zones AS SELECT zoneid, coalesce((SELECT d.name FROM display_names d WHERE d.key = replace(replace(replace(lower(z.name), '_', ''), '-', ''), '''', '')), replace(z.name,'_',' ')) AS name FROM zone_settings z;

-- spell -> mob skill it is learned from (LSB blue_spell_list + CatseyeXI-only spells matched by skill name).
CREATE TABLE blu_spell_skills (spellid INT, mob_skill_id INT);
CREATE INDEX ix_bss ON blu_spell_skills(spellid);
INSERT INTO blu_spell_skills SELECT spellid, mob_skill_id FROM blue_spell_list;

-- Every spawn point of a mob whose skill list contains a blue spell's source skill.
CREATE VIEW blu_sources AS
SELECT bl.spellid, s.* FROM blu_spell_skills bl
JOIN mob_skill_lists sl ON sl.mob_skill_id = bl.mob_skill_id
JOIN spawns s ON s.skill_list_id = sl.skill_list_id;
`;

function diffReport(db: DatabaseSync) {
  // BLU level = byte 16 (job 16) of spell_list.jobs hex; SQLite can't parse hex, so compute here.
  db.exec("CREATE TABLE blu_spells (spellid INT PRIMARY KEY, name TEXT, lsb_level INT, cx_level INT, level INT, set_points INT, content_tag TEXT, cx_notes TEXT, cx_links TEXT, available INT, trait_category INT, trait_weight INT)");
  const cx = new Map<string, any>((db.prepare("SELECT * FROM cx_blu_spells").all() as any[]).map((r) => [norm(r.name), r]));
  const ins = db.prepare("INSERT INTO blu_spells VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  const lines: string[] = ["# LSB vs CatseyeXI diff report", "", `Generated ${new Date().toISOString()}`, ""];
  const seen = new Set<string>();
  const unavailable: string[] = [];
  for (const r of db.prepare("SELECT s.spellid, s.name, s.jobs, s.content_tag, max(b.set_points) set_points, max(b.trait_category) trait_category, max(b.trait_category_weight) trait_weight FROM blue_spell_list b JOIN spell_list s ON s.spellid=b.spellid GROUP BY s.spellid ORDER BY s.spellid").all() as any[]) {
    const lsbLevel = parseInt(String(r.jobs).slice(30, 32), 16);
    const name = titleCase(r.name);
    const o = cx.get(norm(name));
    if (o) seen.add(norm(name));
    // CatseyeXI cap is 75: spells above it exist only if the wiki lists them.
    const available = lsbLevel <= 75 || !!o ? 1 : 0;
    if (!available) unavailable.push(`${name} (LSB lv${lsbLevel})`);
    ins.run(r.spellid, name, lsbLevel, o?.level ?? null, o?.level ?? lsbLevel, r.set_points, r.content_tag, o?.notes ?? null, o?.links ?? null, available, r.trait_category || null, r.trait_weight || null);
  }
  const changed = db.prepare("SELECT name, lsb_level, cx_level, cx_notes FROM blu_spells WHERE cx_level IS NOT NULL ORDER BY name").all() as any[];
  lines.push(`## Blue Magic: ${changed.length} spells added/relocated by CatseyeXI (bg-wiki)`, "", "| Spell | LSB lv | CX lv | CX source |", "|---|---|---|---|");
  for (const c of changed) lines.push(`| ${c.name} | ${c.lsb_level} | ${c.cx_level} | ${c.cx_notes} |`);
  // CatseyeXI-only spells (not in LSB at all): synthetic negative ids, sources via same-named mob skill if any.
  const custom: string[] = [];
  let id = 0;
  for (const [k, o] of cx) {
    if (seen.has(k)) continue;
    ins.run(--id, o.name, null, o.level, o.level, null, "CATSEYE", o.notes, o.links, 1, null, null);
    const skills = db.prepare("SELECT mob_skill_id FROM mob_skills WHERE mob_skill_name = ?").all(o.name.toLowerCase().replace(/ /g, "_")) as any[];
    for (const sk of skills) db.prepare("INSERT INTO blu_spell_skills VALUES (?,?)").run(id, sk.mob_skill_id);
    custom.push(`| ${o.name} | ${o.level} | ${skills.length ? "yes" : "no — wiki notes only"} | ${o.notes} |`);
  }
  lines.push("", `## Blue Magic: ${custom.length} CatseyeXI-only spells (not in LSB)`, "", "| Spell | CX lv | LSB mob skill found | CX source |", "|---|---|---|---|", ...custom);
  lines.push("", `## Blue Magic: ${unavailable.length} LSB spells above 75 not offered on CatseyeXI`, "", unavailable.join(", "));

  // BLU trait tiers: points of set spells in a category needed per tier. JP-only tiers are unreachable at 75.
  db.exec(`CREATE TABLE blu_trait_tiers AS
    SELECT bt.trait_category AS category, (SELECT name FROM traits t WHERE t.traitid = bt.traitid LIMIT 1) AS name,
           bt.tier, bt.trait_points_needed AS points, max(bt.job_points_only) AS jp_only,
           group_concat(coalesce(mn.name, 'mod ' || bt.modifier) || ' ' || CAST(bt.value AS INT), ', ') AS effect
    FROM blue_traits bt LEFT JOIN mod_names mn ON mn.id = bt.modifier
    GROUP BY bt.trait_category, bt.tier, bt.trait_points_needed`);
  writeFileSync(join(root, "data", "diff-report.md"), lines.join("\n") + "\n");
}

// Trusts from CatsEyeXI_Systems/Trusts: one table per role section, rows of Name <sup>(jobs)</sup> | availability icons |
// obtainment (ACE<hr>CW parts) | customized | notes. spellid is the LSB/client trust spell (896+), matched by name.
async function seedTrusts(db: DatabaseSync) {
  db.exec("CREATE TABLE trusts (name TEXT PRIMARY KEY, jobs TEXT, role TEXT, ace INT, cw INT, obtain TEXT, customized INT, notes TEXT, spellid INT)");
  const ids = new Map((db.prepare("SELECT spellid, name FROM spell_list WHERE spellid >= 896").all() as any[]).map((s) => [s.name.toLowerCase().replace(/[^a-z0-9]/g, ""), s.spellid]));
  const text = (s: string) => plain(s.replace(/\[\[File:CatsEyeXI ACE\.png[^\]]*\]\]/g, "ACE: ").replace(/\[\[File:CatsEyeXI CW\.png[^\]]*\]\]/g, "CW: ")
    .replace(/<hr\s*\/?>|<\/?br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/ *\n */g, "\n").replace(/  +/g, " ");
  const ins = db.prepare("INSERT OR REPLACE INTO trusts VALUES (?,?,?,?,?,?,?,?,?)");
  const missing: string[] = [];
  for (const sec of (await wikiText("CatsEyeXI_Systems/Trusts")).split(/\n==(?!=)/).slice(1)) {
    const role = sec.slice(0, sec.indexOf("==")).trim();
    for (const table of wikiTables(sec))
      for (const [nameCell, avail = "", obtain = "", custom = "", notes = ""] of table) {
        const m = nameCell.match(/\[\[[^\]|]+\|([^\]]+)\]\]\s*<sup>\(([^)]*)\)<\/sup>/);
        if (!m) continue;
        // Unity Concord trusts are short in LSB: naja_uc, jakoh_uc, i_shield_uc.
        const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const spellid = ids.get(key(m[1])) ?? ids.get(key(m[1].replace(/^(\w)\w* Shield/, "$1Shield").replace(/^(\w+)[^(]*\(UC\)/, "$1uc"))) ?? null;
        if (spellid == null) missing.push(m[1]);
        ins.run(m[1].trim(), m[2], role, +avail.includes("ACE.png"), +avail.includes("CW.png"), text(obtain), +/yes/i.test(custom), text(notes) || null, spellid);
      }
  }
  if (missing.length) console.log("trusts without an LSB spell:", missing.join(", "));
}

const lsbShow = (f: string) => execFileSync("git", ["-C", join(LSB_SQL, ".."), "show", `HEAD:${f}`], { encoding: "utf8", maxBuffer: 1 << 26 });
const lsbGrep = (re: string, path: string) => execFileSync("git", ["-C", join(LSB_SQL, ".."), "grep", "-n", "-E", re, "HEAD", "--", path],
  { encoding: "utf8", maxBuffer: 1 << 26 }).split(/\r?\n/).filter(Boolean);

// Sleep / silence risk per mob, for the Training page's leveling suggestions: TP moves whose LSB script applies the
// effect, plus spells by name (a mob spell only counts from its min_level).
function seedStatusRisk(db: DatabaseSync) {
  db.exec("CREATE TABLE status_skills (name TEXT, kind TEXT, PRIMARY KEY (name, kind))");
  const ins = db.prepare("INSERT OR IGNORE INTO status_skills VALUES (?,?)");
  for (const l of lsbGrep("effect\\.(SLEEP_I|SLEEP_II|LULLABY|SILENCE)\\b", "scripts/actions/mobskills")) {
    if (/delStatusEffect|hasStatusEffect|eraseStatusEffect/.test(l)) continue; // removers and checks, not inflicters
    const m = l.match(/mobskills\/(\w+)\.lua:\d+:.*effect\.(\w+)/);
    if (m) ins.run(m[1], m[2] === "SILENCE" ? "silence" : "sleep");
  }
  db.function("regexp", (re: string, s: string) => (new RegExp(re).test(s ?? "") ? 1 : 0));
  const skills = (kind: string) => `SELECT group_concat(DISTINCT replace(k.mob_skill_name, '_', ' ')) FROM mob_skill_lists sl
    JOIN mob_skills k ON k.mob_skill_id = sl.mob_skill_id JOIN status_skills st ON st.name = k.mob_skill_name AND st.kind = '${kind}'
    WHERE sl.skill_list_id = mob_index.skill_list_id`;
  const spells = (re: string) => `SELECT group_concat(DISTINCT replace(s.name, '_', ' ')) FROM mob_pools p
    JOIN mob_spell_lists l ON l.spell_list_id = p.spellList JOIN spell_list s ON s.spellid = l.spell_id
    WHERE p.poolid = mob_index.poolid AND l.min_level <= mob_index.hi AND s.name REGEXP '${re}'`;
  const both = (a: string, b: string) => `nullif(trim(coalesce((${a}), '') || ',' || coalesce((${b}), ''), ','), '')`;
  db.exec(`ALTER TABLE mob_index ADD COLUMN sleeps TEXT; ALTER TABLE mob_index ADD COLUMN silences TEXT;
    UPDATE mob_index SET sleeps = ${both(skills("sleep"), spells("^(sleep|sleepga|repose|.*lullaby)"))},
      silences = ${both(skills("silence"), spells("^silence"))};`);
}

// Fields / Grounds of Valor training regimes: page rows from LSB scripts/globals/regimes.lua (counts, level range,
// reward, regime id) and targets from the mob scripts that call xi.regime.checkRegime(player, mob, id, index, type).
function seedRegimes(db: DatabaseSync) {
  db.exec(`CREATE TABLE regimes (type TEXT, id INT, zoneid INT, lo INT, hi INT, counts TEXT, reward INT, PRIMARY KEY (type, id));
    CREATE TABLE regime_targets (type TEXT, id INT, idx INT, mobname TEXT, zoneid INT)`);
  const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const zoneId = new Map((db.prepare("SELECT zoneid, name FROM zone_settings").all() as any[]).map((z) => [key(z.name), z.zoneid as number]));
  const ins = db.prepare("INSERT OR IGNORE INTO regimes VALUES (?,?,?,?,?,?,?)");
  let type = "", zone: number | undefined;
  for (const line of lsbShow("scripts/globals/regimes.lua").split(/\r?\n/)) {
    const t = line.match(/\[xi\.regime\.type\.(FIELDS|GROUNDS)\] =/);
    if (t) { type = t[1] === "FIELDS" ? "FoV" : "GoV"; continue; }
    const z = line.match(/^\s+\[xi\.zone\.(\w+)\] =/);
    if (z) { zone = zoneId.get(key(z[1])); assert(zone, `regime zone ${z[1]}`); continue; }
    const r = line.match(/^\s+\{\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\s*\},/);
    if (r && type && zone) ins.run(type, Number(r[8]), zone, Number(r[5]), Number(r[6]), r.slice(1, 5).filter((n) => n !== "0").join(","), Number(r[7]));
  }
  const tgt = db.prepare("INSERT INTO regime_targets VALUES (?,?,?,?,?)");
  for (const l of lsbGrep("checkRegime\\(player, mob, [0-9]+, [0-9]+, xi\\.regime\\.type\\.", "scripts/zones")) {
    const m = l.match(/zones\/(\w+)\/mobs\/(\w+)\.lua:\d+:.*checkRegime\(player, mob, (\d+), (\d+), xi\.regime\.type\.(FIELDS|GROUNDS)/);
    const zid = m && zoneId.get(key(m[1]));
    if (m && zid) tgt.run(m[5] === "FIELDS" ? "FoV" : "GoV", Number(m[3]), Number(m[4]), m[2], zid);
  }
  db.exec("CREATE INDEX ix_rt ON regime_targets(type, id)");
}

// Merits as of the Lv75 era: LSB data/merits.yaml with modules/era/data/merits.yaml merged over it. A merit's cap is its
// cost table's length unless it sets max_upgrades; max_upgrades 0 (on a merit or a whole category) disables it.
function seedMerits(db: DatabaseSync) {
  const show = (f: string) => execFileSync("git", ["-C", join(LSB_SQL, ".."), "show", `HEAD:${f}`], { encoding: "utf8" });
  // ponytail: parses only the YAML subset merits.yaml uses (nested maps, scalars, inline [lists]); "- " list items skipped
  const yaml = (text: string) => {
    const root: any = {}, stack = [{ ind: -1, obj: root }];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, "");
      const m = line.trim().match(/^([^:-][^:]*):\s*(.*)$/);
      if (!m) continue;
      const ind = line.search(/\S/);
      while (stack.at(-1)!.ind >= ind) stack.pop();
      const parent = stack.at(-1)!.obj, [, k, v] = m, num = (s: string) => (isNaN(Number(s)) ? s : Number(s));
      if (v === "") stack.push({ ind, obj: (parent[k] ??= {}) });
      else parent[k] = v.startsWith("[") ? v.slice(1, -1).split(",").map((s) => num(s.trim())) : num(v);
    }
    return root;
  };
  const merge = (a: any, b: any) => {
    for (const k in b) a[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] ? merge(a[k], b[k]) : b[k];
    return a;
  };
  const m = merge(yaml(show("data/merits.yaml")), yaml(show("modules/era/data/merits.yaml"))).merits;
  const WORDS: Record<string, string> = { hp: "HP", mp: "MP", str: "STR", dex: "DEX", vit: "VIT", agi: "AGI", int: "INT", mnd: "MND", chr: "CHR",
    tp: "TP", ii: "II", iii: "III", v: "V", hand: "Hand-to-Hand", adventurers: "Adventurer's", assassins: "Assassin's", warriors: "Warrior's" };
  const name = (k: string) => k.replace(/_skill$/, "").replace(/^hand_to_hand$/, "hand").split("_").map((w) => WORDS[w] ?? w[0].toUpperCase() + w.slice(1)).join(" ")
    .replace(/ San$/, ": San").replace("Acc Att", "Acc./Att.").replace("Enemy Crit Rate", "Enemy Critical Hit Rate").replace("Crit Hit", "Critical Hit");
  db.exec("CREATE TABLE merits (id INTEGER PRIMARY KEY, cat TEXT, cap INT, name TEXT, costs TEXT, ord INT)");
  const ins = db.prepare("INSERT INTO merits VALUES (?,?,?,?,?,?)");
  let ord = 0;
  for (const [cat, c] of Object.entries<any>(m.categories)) {
    if (!c.max_upgrades) continue;
    for (const [k, x] of Object.entries<any>(c.merits ?? {})) {
      const costs: number[] = m.upgrade_costs[x.upgrade_cost];
      const max = x.max_upgrades ?? costs.length;
      if (!max || x.jobs?.every((j: string) => j === "geo" || j === "run")) continue;
      ins.run(x.id, cat, c.max_upgrades, name(k), costs.slice(0, max).join(","), ord++);
    }
  }
  console.log(`merits: ${ord}`);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const titleCase = (s: string) => s.split("_").map((w) => (["of", "the"].includes(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");

function selfCheck(db: DatabaseSync) {
  const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
  for (const t of TABLES) assert(one(`SELECT count(*) c FROM ${t}`).c > 0, `${t} empty`);
  assert.equal(one("SELECT name FROM mod_names WHERE id=8").name, "STR");
  const kupipi = one("SELECT * FROM trusts WHERE name='Kupipi'");
  assert.deepEqual([kupipi.jobs, kupipi.role, kupipi.spellid, kupipi.ace, kupipi.cw], ["WHM", "Healers", 898, 1, 1]);
  assert(one("SELECT count(*) c FROM trusts").c > 50, "trusts parsed");
  const vorpal = one("SELECT * FROM sc_skills WHERE kind='ws' AND name='Vorpal Blade'");
  assert.deepEqual([vorpal.sc1, vorpal.sc2, vorpal.weapon], [4, 8, "Sword"]); // Scission, Impaction
  assert.equal(one("SELECT tag FROM sc_skills WHERE name='Knights Of Round'").tag, "Relic");
  assert(!one("SELECT 1 x FROM sc_skills WHERE name='Requiescat'"), "99-era weapon skills left out");
  const fov1 = one("SELECT * FROM regimes WHERE type='FoV' AND id=1");
  assert.deepEqual([fov1.zoneid, fov1.lo, fov1.hi, fov1.counts], [100, 1, 6, "6"]); // West Ronfaure
  assert(one("SELECT 1 x FROM regime_targets WHERE type='FoV' AND id=2 AND mobname='Forest_Hare'"), "regime targets from mob scripts");
  assert(one("SELECT 1 x FROM mob_index WHERE sleeps LIKE '%sheep song%'"), "Sheep Song is a sleep risk");
  assert(one("SELECT count(*) c FROM mob_index WHERE silences IS NOT NULL").c > 50, "silence risks found");
  assert(one("SELECT count(*) c FROM sc_skills WHERE kind='blu'").c > 30, "blue magic skillchain spells");
  assert.equal(one("SELECT name FROM zones WHERE zoneid=33").name, "Al'Taieu");
  assert.equal(one("SELECT name FROM mob_index WHERE mobname='Omaern' LIMIT 1").name, "Om'aern");
  const sheep = one("SELECT * FROM blu_spells WHERE name='Sheep Song'");
  assert.equal(sheep.level, 16);
  assert.equal(sheep.description, "Puts all enemies within range to sleep");
  assert.equal(sheep.spell_type, "Magical (Light)");
  assert.equal(sheep.stats, "HP+5, CHR+1");
  const konschtat = one("SELECT count(*) c FROM blu_sources s JOIN blu_spells b USING (spellid) WHERE b.name='Sheep Song' AND s.zoneid=108").c;
  assert(konschtat > 0, "Sheep Song should be learnable in Konschtat Highlands");
  const acrid = one("SELECT * FROM blu_spells WHERE name='Acrid Stream'");
  assert.equal(acrid.level, 75);
  assert.match(acrid.cx_notes, /Clionid/);
  assert.equal(acrid.available, 1);
  assert.equal(one("SELECT sc FROM blu_spells WHERE name='Head Butt'").sc, "Impaction");
  assert(one("SELECT count(*) c FROM mob_droplist d JOIN item_basic i ON i.itemid=d.itemId WHERE i.name='sheepskin'").c > 0);
  assert(one("SELECT count(*) c FROM checklist_seed WHERE list='CatsEyeXI Quests'").c > 50);
  assert(one("SELECT count(*) c FROM checklist_seed WHERE list='Bastok Missions'").c >= 15);
  const refresh = one("SELECT points FROM blu_trait_tiers WHERE name='auto refresh' AND jp_only=0");
  assert.equal(refresh.points, 8);
  assert(one("SELECT sum(trait_weight) w FROM blu_spells WHERE trait_category=(SELECT category FROM blu_trait_tiers WHERE name='auto refresh') AND available=1").w >= 8);
  // Fit recovers a known transform, and rejects a bad pair.
  const truth = (x: number, z: number) => ({ x, z, px: 0.2 * x + 256, py: -0.2 * z + 256 });
  const fit = fitMap([truth(0, 0), truth(500, 300), truth(-400, 100), truth(200, -600), { x: 100, z: 100, px: 500, py: 20 }])!;
  assert(Math.abs(fit.a - 0.2) < 1e-9 && Math.abs(fit.c + 0.2) < 1e-9 && fit.n === 4);
  assert(one("SELECT count(*) c FROM zone_maps WHERE zoneid=108").c >= 1, "Konschtat map");
  assert(one("SELECT blu FROM mob_index WHERE mobname='Mad_Sheep' AND zoneid=108").blu.includes("Sheep Song"));
  const crawler = one("SELECT * FROM mob_index WHERE mobname='Eschan_Crawler' AND zoneid=288");
  assert(crawler && crawler.era === 1 && crawler.cx_lo != null, "Escha - Zi'Tah mobs should be CatseyeXI content");
  assert.equal(one("SELECT count(*) c FROM mob_index WHERE zoneid=261 AND era=1").c, 0, "Ceizak (Adoulin) isn't 75-cap content");
  assert.equal(one("SELECT name FROM quest_names WHERE log=0 AND id=0").name, "A Sentrys Peril");
  assert.equal(one("SELECT name FROM mission_names WHERE log=0 AND id=0").name, "Smash The Orcish Scouts");
  assert.deepEqual({ ...one("SELECT * FROM merits WHERE id=0x40") }, { id: 0x40, cat: "hp_mp", cap: 8, name: "Max HP", costs: "1,2,3,4,5,5,5,5", ord: 0 });
  assert.equal(one("SELECT costs FROM merits WHERE name='Protectra V'").costs, "3,4,5", "era re-adds merited spells");
  assert(!one("SELECT 1 x FROM merits WHERE cat IN ('weapon_skills', 'geo_group_1') OR name IN ('Max Merit', 'Geomancy')"), "post-75 merits left out");
  assert.equal(one("SELECT count(DISTINCT cat) c FROM merits").c, 45, "5 general categories + 2 groups for 20 jobs");
  console.log("self-check ok");
}

main().catch((e) => { console.error(e); process.exit(1); });
