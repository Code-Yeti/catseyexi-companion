import { useCallback, useEffect, useRef, useState } from "react";
import { pretty, setDisplayNames, expGain, wsPoints, parseWsPoints, type ExpSnap } from "./ffxi";
import "./style.css";
import { Ctx, type Friend, type Page } from "./ctx";
import { getChar, getOwned, type Character } from "./catseye";
import { getKv, setKv, q, uq, uexec } from "./db";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { readLive, isFresh, storageIndex, type Live, type Trial } from "./live";
import TargetCard from "./components/TargetCard";
import ExpBar from "./components/ExpBar";
import TallyTimer from "./components/TallyTimer";
import { usePrefs, chime } from "./prefs";
import CharacterPage from "./pages/Character";
import Search from "./pages/Search";
import Mob from "./pages/Mob";
import Mobs from "./pages/Mobs";
import Item from "./pages/Item";
import BlueMage from "./pages/BlueMage";
import Gear from "./pages/Gear";
import Progress from "./pages/Progress";
import Training from "./pages/Training";
import Friends from "./pages/Friends";
import Settings from "./pages/Settings";
import LiveMap from "./pages/LiveMap";
import Storage from "./pages/Storage";
import Skillchains from "./pages/Skillchains";
import Trusts from "./pages/Trusts";
import Portrait from "./components/Portrait";

const NAV: [Page["name"], string][] = [
  ["character", "Character"], ["map", "Map"], ["search", "Search"], ["mobs", "Mobs"], ["blu", "Blue Magic"], ["skillchains", "Skillchains"],
  ["gear", "Gear"], ["storage", "Storage"], ["progress", "Progress"], ["training", "Training"], ["trusts", "Trusts"], ["friends", "Friends"], ["settings", "Settings"],
];
const FRIEND_POLL_MS = 3 * 60_000; // be gentle with catseyexi.com: your character + each friend, once per tick
const INVENTORY_EVERY = 5;          // ticks (~15 min); inventory changes slowly


export default function App() {
  const [page, setPage] = useState<Page>({ name: "character" });
  const [prefs] = usePrefs();
  const [history, setHistory] = useState<Page[]>([]);
  const [charId, setCharId] = useState<string>();
  const [char, setChar] = useState<Character>();
  const [owned, setOwned] = useState<Set<number>>(new Set());
  const [fetchedAt, setFetchedAt] = useState<number>();
  const [stale, setStale] = useState<string>();
  const [err, setErr] = useState<string>();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [zones, setZones] = useState<Map<number, string>>(new Map());
  const friendIds = useRef<string[]>([]);
  const charKeyRef = useRef<string | undefined>(undefined);
  charKeyRef.current = charId;
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  // Online state from the previous *live* check. A toast fires only on an offline -> online change between two live
  // checks, so opening the app doesn't toast everyone who's already on.
  const lastLive = useRef(new Map<string, boolean>());
  const [toasts, setToastsState] = useState(true);
  const toastsRef = useRef(true);
  // In-app toasts (bottom-right); the taskbar button also flashes if the window isn't focused (e.g. behind the game).
  const [popups, setPopups] = useState<{ id: number; title: string; body: string; to: Page }[]>([]);
  const toast = useCallback((title: string, body: string, to: Page = { name: "friends" }) => {
    const id = Date.now() + Math.random();
    setPopups((p) => [...p, { id, title, body, to }]);
    setTimeout(() => setPopups((p) => p.filter((x) => x.id !== id)), 10_000);
    getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(() => {});
  }, []);
  const toastRef = useRef(toast);
  const setToasts = (on: boolean) => { toastsRef.current = on; setToastsState(on); setKv("friendToasts", on ? "1" : "0"); };

  const go = useCallback((p: Page) => { setHistory((h) => [...h.slice(-30), page]); setPage(p); }, [page]);

  // quiet = background refresh: keep what we have on failure and don't show an error banner.
  const lastBlu = useRef<number | undefined>(undefined);
  const loadChar = useCallback(async (id: string, refresh = false, opts: { quiet?: boolean; inventory?: boolean } = {}) => {
    if (!opts.quiet) setErr(undefined);
    try {
      const c = await getChar(id, refresh);
      setChar(c.data); setFetchedAt(c.fetchedAt); setStale(c.stale);
      if (opts.inventory ?? true) {
        const o = await getOwned(id, refresh && (opts.inventory ?? true)).catch(() => null);
        if (o) setOwned(o);
      }
      setCharId(id);
      await setKv("charId", id);
      // BLU level went up since the last load: say which spells just became learnable.
      const blu = c.data.jobs.blu ?? 0, was = lastBlu.current;
      lastBlu.current = blu;
      if (was !== undefined && blu > was) {
        const fresh = await q<{ name: string }>("SELECT name FROM blu_spells WHERE available=1 AND level > $1 AND level <= $2 ORDER BY level", was, blu);
        toastRef.current(`Blue Mage ${blu}!`, fresh.length ? `Now learnable: ${fresh.map((f) => f.name).join(", ")}` : "No new spells at this level.");
      }
    } catch (e) { if (!opts.quiet) setErr(`Couldn't load character ${id}: ${e}`); }
  }, []);

  // Friends: one request per friend, sequential with a short gap, every few minutes while the app is open.
  const checkFriend = async (id: string, refresh: boolean): Promise<Friend> => {
    try {
      const c = await getChar(id, refresh);
      return { id, char: c.data, checked: c.stale ? undefined : c.fetchedAt, err: c.stale };
    } catch (e) { return { id, err: String(e) }; }
  };
  const refreshFriends = useCallback(async (refresh = true) => {
    for (const id of friendIds.current) {
      const f = await checkFriend(id, refresh);
      if (refresh && f.char && !f.err) {
        const was = lastLive.current.get(id);
        if (was === false && f.char.isOnline && toastsRef.current)
          toastRef.current(`${f.char.charname} is online`, `${zonesRef.current.get(f.char.pos_zone) ?? "CatseyeXI"}`);
        lastLive.current.set(id, f.char.isOnline);
      }
      setFriends((fs) => fs.map((x) => (x.id === id ? { ...x, ...f, char: f.char ?? x.char } : x)));
      await new Promise((r) => setTimeout(r, 300));
    }
  }, []);
  const addFriend = async (id: string) => {
    if (friendIds.current.includes(id)) return;
    const f = await checkFriend(id, true);
    if (!f.char) throw new Error(f.err);
    await uexec("INSERT OR IGNORE INTO friends VALUES ($1,$2)", id, Date.now());
    friendIds.current = [...friendIds.current, id];
    setFriends((fs) => [...fs, f]);
  };
  const removeFriend = async (id: string) => {
    await uexec("DELETE FROM friends WHERE id=$1", id);
    friendIds.current = friendIds.current.filter((x) => x !== id);
    setFriends((fs) => fs.filter((f) => f.id !== id));
  };

  useEffect(() => {
    // Your character: cached copy instantly, then live, then every tick (inventory every INVENTORY_EVERY ticks).
    let charKey: string | undefined, tick = 0;
    getKv("charId").then(async (id) => {
      charKey = id;
      if (id) { await loadChar(id); await loadChar(id, true, { quiet: true }); }
    }).catch((e) => setErr(String(e)));
    getKv("friendToasts").then((v) => { toastsRef.current = v !== "0"; setToastsState(v !== "0"); });
    q<{ key: string; name: string }>("SELECT key, name FROM display_names").then(setDisplayNames)
      .then(() => q<{ zoneid: number; name: string }>("SELECT zoneid, name FROM zones")).then((r) => setZones(new Map(r.map((z) => [z.zoneid, z.name])))); // re-render with them
    uq<{ id: string }>("SELECT id FROM friends ORDER BY added").then(async (r) => {
      friendIds.current = r.map((x) => x.id);
      setFriends(r.map((x) => ({ id: x.id })));
      await refreshFriends(false); // cached first for instant display...
      await refreshFriends(true);  // ...then live
    });
    const t = setInterval(async () => {
      const id = charKeyRef.current ?? charKey;
      if (id) await loadChar(id, true, { quiet: true, inventory: ++tick % INVENTORY_EVERY === 0 });
      await refreshFriends(true);
    }, FRIEND_POLL_MS);
    return () => clearInterval(t);
  }, [loadChar, refreshFriends]);

  // ---- Optional Ashita addon bridge (live.json, ~1/s). Only trusted when fresh and for the loaded character. ----
  const [liveRaw, setLiveRaw] = useState<Live | null>(null);
  const live = isFresh(liveRaw) && (!char || liveRaw.char === char.charname) ? liveRaw : null;
  const [liveLearned, setLiveLearned] = useState<Set<string> | null>(null);
  const learnedKey = useRef("");
  useEffect(() => {
    // A failed read (the addon swaps the file in place) keeps the last data; isFresh() still drops it after STALE_SECONDS.
    const t = setInterval(async () => { const l = await readLive(); setLiveRaw((prev) => l ?? prev); }, 1000);
    return () => clearInterval(t);
  }, []);
  // Learned Blue Magic from the client -> our spell names, mirrored into user.db so it survives without the addon.
  useEffect(() => {
    if (!live?.bluKnown) { setLiveLearned(null); learnedKey.current = ""; return; } // recompute when the addon comes back
    const key = live.bluKnown.map((k) => k[0]).join(",");
    if (key === learnedKey.current) return;
    learnedKey.current = key;
    (async () => {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const ours = await q<{ name: string; lsb_level: number | null }>("SELECT name, lsb_level FROM blu_spells");
      const byNorm = new Map(ours.map((o) => [norm(o.name), o]));
      const known = new Set(live.bluKnown!.map(([, n]) => byNorm.get(norm(n))?.name).filter(Boolean) as string[]);
      // Spells the client has data for (all LSB ones) follow the game; CatseyeXI-only extras keep any manual tick.
      for (const o of ours) {
        if (known.has(o.name)) await uexec("INSERT OR IGNORE INTO blu_learned VALUES ($1)", o.name);
        else if (o.lsb_level != null) await uexec("DELETE FROM blu_learned WHERE name=$1", o.name);
      }
      setLiveLearned(known);
    })();
  }, [live?.bluKnown]);
  // "You learn X!" events -> popup + history (each event once, across restarts).
  useEffect(() => {
    if (!live?.events?.length) return;
    (async () => {
      const seen = Number(await getKv("lastLearnEvent") ?? 0);
      const fresh = live.events!.filter((e) => e.time > seen);
      if (!fresh.length) return;
      if (prefs.soundLearned) chime("learned");
      for (const e of fresh) {
        const name = live.bluKnown?.find(([id]) => id === e.spell)?.[1]
          ?? (await q<{ name: string }>("SELECT name FROM blu_spells WHERE spellid=$1", e.spell))[0]?.name ?? `Spell #${e.spell}`;
        await uexec("INSERT OR REPLACE INTO blu_history VALUES ($1,$2,$3,$4)", name, e.zone, e.mob, e.time);
        toast(`Learned ${name}!`, [e.mob, zones.get(e.zone)].filter(Boolean).join(" · "), { name: "blu" });
      }
      await setKv("lastLearnEvent", String(Math.max(...fresh.map((e) => e.time))));
    })();
  }, [live?.events?.length]);
  // Weapon skill trials (user.db kv "wsTrials", by item id). The weapon's own count only reaches the client when the
  // item is resent (zoning), so in between we estimate: each of your weapon skills on a mob waits until you gain EXP or
  // limit points (the server only awards points against mobs that give EXP), then its points go to that hand's weapon.
  const trialsRef = useRef<Record<string, Trial> | null>(null);
  const trialInfo = useRef(new Map<number, { need: number; name: string }>());
  const rangedWs = useRef<Set<number> | null>(null);
  const wsSeen = useRef(0);
  const pendingWs = useRef<{ weapon: number; pts: number; time: number }[]>([]);
  const prevExp = useRef<ExpSnap | undefined>(undefined);
  const trialBusy = useRef(false);
  useEffect(() => {
    if (!live || trialBusy.current) return; // a skipped tick is caught up on the next one
    trialBusy.current = true;
    (async () => {
      trialsRef.current ??= JSON.parse((await getKv("wsTrials")) ?? "{}") as Record<string, Trial>;
      rangedWs.current ??= new Set((await q<{ id: number }>("SELECT id FROM sc_skills WHERE kind='ws' AND weapon IN ('Archery','Marksmanship')")).map((r) => r.id));
      const t = trialsRef.current, now = Date.now() / 1000;
      const info = async (id: number) => {
        if (!trialInfo.current.has(id)) {
          const r = await q<{ need: number; name: string }>("SELECT coalesce(w.unlock_points, 0) need, b.name FROM item_basic b LEFT JOIN item_weapon w ON w.itemId = b.itemid WHERE b.itemid = $1", id);
          trialInfo.current.set(id, r[0] ?? { need: 0, name: `#${id}` });
        }
        return trialInfo.current.get(id)!;
      };
      const total = (x?: Trial) => (x ? x.points + (x.extra ?? 0) : 0);
      const done = (name: string, estimate: boolean) => {
        toast(`${pretty(name)} trial complete!`, estimate ? "By the app's count: zone to confirm, then take it back to the quest NPC." : "Take it back to the quest NPC to learn the weapon skill.", { name: "progress" });
        if (prefs.soundLearned) chime("learned");
      };
      let dirty = false;
      // 1. The weapon's own (exact) count, whenever the client has a new one: replaces the estimate.
      for (const w of live.weapons ?? []) {
        const { need, name } = await info(w.id);
        if (!need || (t[w.id] && w.wsPoints <= t[w.id].points)) continue; // the count only grows; CatseyeXI often reports 0
        const old = t[w.id];
        t[w.id] = { points: w.wsPoints, need, ts: Math.floor(now), extra: 0 };
        dirty = true;
        if (old && total(old) < need && w.wsPoints >= need) done(name, false);
      }
      // 1b. "!wspoints main|sub|ranged" replies: the server's own count. Only trusted when non-zero, since CatseyeXI
      // reported 0 for a trial weapon that was mid-progress.
      for (const l of live.ventureLog ?? []) {
        const r = parseWsPoints(l.text), w = r && live.weapons?.find((x) => x.slot === r.slot);
        if (!r || !w || !r.points || l.time <= (t[w.id]?.ts ?? 0)) continue;
        const { need } = await info(w.id);
        if (need) { t[w.id] = { points: r.points, need, ts: l.time, extra: 0 }; dirty = true; }
      }
      // 2. New weapon skills on mobs (server ids from 0x01000000) wait for EXP, for the weapon in that hand.
      const used = live.wsUsed ?? [];
      if (!wsSeen.current) wsSeen.current = Math.max(1, ...used.map((u) => u.time)); // older ones were before this app run
      for (const u of used) {
        if (u.time <= wsSeen.current) continue;
        wsSeen.current = u.time;
        const weapon = live.weapons?.find((w) => w.slot === (rangedWs.current!.has(u.ws) ? 2 : 0));
        if (weapon && u.target >= 0x1000000 && (await info(weapon.id)).need) pendingWs.current.push({ weapon: weapon.id, pts: wsPoints(u.sc), time: u.time });
      }
      // 3. EXP or limit points gained: the mob counted, so bank what's pending.
      if (live.exp) {
        const snap: ExpSnap = { job: live.mainJob, lvl: live.mainLevel, cur: live.exp.cur, need: live.exp.need, limit: live.exp.limit, merits: live.exp.merits };
        const gained = prevExp.current ? expGain(prevExp.current, snap) : 0;
        prevExp.current = snap;
        if (gained) {
          for (const p of pendingWs.current) {
            const x = t[p.weapon];
            if (!x) continue;
            const before = total(x);
            x.extra = (x.extra ?? 0) + p.pts;
            dirty = true;
            if (before < x.need && total(x) >= x.need) done((await info(p.weapon)).name, true);
          }
          pendingWs.current = [];
        }
      }
      pendingWs.current = pendingWs.current.filter((p) => now - p.time < 300); // no EXP within 5 min: too weak, or you died
      if (dirty) setKv("wsTrials", JSON.stringify(t));
    })().finally(() => { trialBusy.current = false; });
  }, [live?.ts]);
  // Tracked chat lines (Ventures, training, Records of Eminence): kept in user.db (kv "ventureLog", last 500) so the
  // Progress and Training pages work with the game closed. n tells apart identical lines in the same second.
  const ventureKey = useRef("");
  useEffect(() => {
    const lines = live?.ventureLog;
    if (!lines?.length) return;
    const k = JSON.stringify(lines[lines.length - 1]);
    if (k === ventureKey.current) return;
    ventureKey.current = k;
    (async () => {
      const old: { text: string; time: number; n?: number; mob?: string }[] = JSON.parse((await getKv("ventureLog")) ?? "[]");
      const id = (l: { text: string; time: number; n?: number }) => `${l.time}|${l.n ?? ""}|${l.text}`;
      const seen = new Set(old.map(id));
      await setKv("ventureLog", JSON.stringify([...old, ...lines.filter((l) => !seen.has(id(l)))].slice(-500)));
    })();
  }, [live?.ventureLog]);
  // Keep the last quest/mission log so Progress can show it with the game closed.
  const logsKey = useRef("");
  useEffect(() => {
    if (!live?.logs) return;
    const k = JSON.stringify(live.logs);
    if (k === logsKey.current) return;
    logsKey.current = k;
    setKv("gameLogs", JSON.stringify({ char: live.char, ts: live.ts, logs: live.logs }));
  }, [live?.logs]);
  const where = storageIndex(live);
  const ownedAll = live?.storage ? new Set([...owned, ...where.keys()]) : owned;

  const body = (() => {
    switch (page.name) {
      case "character": return <CharacterPage />;
      case "search": return <Search initial={page.q} />;
      case "mob": return <Mob key={page.mob} name={page.mob} />;
      case "mobs": return <Mobs />;
      case "item": return <Item key={page.id} id={page.id} />;
      case "blu": return <BlueMage />;
      case "gear": return <Gear />;
      case "progress": return <Progress />;
      case "training": return <Training />;
      case "friends": return <Friends />;
      case "settings": return <Settings />;
      case "map": return <LiveMap />;
      case "storage": return <Storage />;
      case "skillchains": return <Skillchains />;
      case "trusts": return <Trusts />;
    }
  })();

  const online = friends.filter((f) => f.char?.isOnline);

  return (
    <Ctx.Provider value={{ charId, char, owned: ownedAll, where, live, liveLearned, fetchedAt, stale, go, loadChar, friends, addFriend, removeFriend,
      refreshFriends: () => refreshFriends(true), zoneName: (id) => zones.get(id), toasts, setToasts, toast }}>
      <div className="shell">
        <nav>
          {char && <Portrait race={char.race} job={char.mjob} size={340} className="nav-art" />}
          <div className="brand">CatseyeXI<br /><small>Companion</small></div>
          {NAV.map(([n, label]) => (
            <button key={n} className={page.name === n ? "active" : ""} onClick={() => go({ name: n } as Page)}>{label}</button>
          ))}
          {history.length > 0 && <button className="back" onClick={() => { setPage(history[history.length - 1]); setHistory((h) => h.slice(0, -1)); }}>← Back</button>}
          {friends.length > 0 && (
            <div className="friends-mini" onClick={() => go({ name: "friends" })} title="Friends">
              <div className="muted">Friends online {online.length}/{friends.length}</div>
              {online.map((f) => (
                <div key={f.id} title={zones.get(f.char!.pos_zone)}><span className="dot-on" /> {f.char!.charname}</div>
              ))}
            </div>
          )}
          <TallyTimer />
          <ExpBar />
          {char && <div className="who">{char.charname}</div>}
        </nav>
        <main>
          {err && <div className="error">{err}</div>}
          {body}
        </main>
        <TargetCard />
        <div className="toasts">
          {popups.map((p) => (
            <div key={p.id} className="toast" onClick={() => { setPopups((x) => x.filter((y) => y.id !== p.id)); setPage(p.to); }}>
              <span className="dot-on" /> <b>{p.title}</b><div className="muted">{p.body}</div>
            </div>
          ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}
