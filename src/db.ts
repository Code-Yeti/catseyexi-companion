import Database from "@tauri-apps/plugin-sql";
import { resolveResource } from "@tauri-apps/api/path";

// reference.db: read-only game data built by scripts/build-db.ts, bundled as a resource.
// user.db: your own data, lives in %APPDATA%\com.ffxi.catseyecompanion.
let refP: Promise<Database> | undefined;
let userP: Promise<Database> | undefined;

export const ref = () =>
  (refP ??= resolveResource("resources/reference.db").then((p) => Database.load("sqlite:" + p.replace(/^\\\\\?\\/, ""))));

export const user = () =>
  (userP ??= Database.load("sqlite:user.db").then(async (db) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS api_cache (url TEXT PRIMARY KEY, body TEXT, fetched_at INT);
      CREATE TABLE IF NOT EXISTS blu_learned (name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS gearsets (id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT, name TEXT, slots TEXT);
      CREATE TABLE IF NOT EXISTS checklist (list TEXT, item TEXT, done INT DEFAULT 0, PRIMARY KEY (list, item));
      CREATE TABLE IF NOT EXISTS map_fit (file TEXT PRIMARY KEY, a REAL, b REAL, c REAL, d REAL);
      CREATE TABLE IF NOT EXISTS friends (id TEXT PRIMARY KEY, added INT);
      CREATE TABLE IF NOT EXISTS blu_history (name TEXT PRIMARY KEY, zoneid INT, mob TEXT, time INT);`);
    return db;
  }));

export const q = async <T = any>(sql: string, ...args: unknown[]) => (await ref()).select<T[]>(sql, args);
export const uq = async <T = any>(sql: string, ...args: unknown[]) => (await user()).select<T[]>(sql, args);
export const uexec = async (sql: string, ...args: unknown[]) => (await user()).execute(sql, args);

export const getKv = async (k: string) => (await uq<{ v: string }>("SELECT v FROM kv WHERE k=$1", k))[0]?.v;
export const setKv = (k: string, v: string) => uexec("INSERT OR REPLACE INTO kv VALUES ($1,$2)", k, v);
