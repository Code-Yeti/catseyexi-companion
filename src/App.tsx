import { useCallback, useEffect, useRef, useState } from "react";
import "./style.css";
import { Ctx, type Friend, type Page } from "./ctx";
import { getChar, getOwned, type Character } from "./catseye";
import { getKv, setKv, q, uq, uexec } from "./db";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { readLive, isFresh, storageIndex, type Live } from "./live";
import TargetCard from "./components/TargetCard";
import { usePrefs, chime } from "./prefs";
import CharacterPage from "./pages/Character";
import Search from "./pages/Search";
import Mob from "./pages/Mob";
import Mobs from "./pages/Mobs";
import Item from "./pages/Item";
import BlueMage from "./pages/BlueMage";
import Gear from "./pages/Gear";
import Progress from "./pages/Progress";
import Friends from "./pages/Friends";
import Settings from "./pages/Settings";
import LiveMap from "./pages/LiveMap";
import Storage from "./pages/Storage";

const NAV: [Page["name"], string][] = [
  ["character", "Character"], ["map", "Map"], ["search", "Search"], ["mobs", "Mobs"], ["blu", "Blue Magic"],
  ["gear", "Gear"], ["storage", "Storage"], ["progress", "Progress"], ["friends", "Friends"], ["settings", "Settings"],
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
    q<{ zoneid: number; name: string }>("SELECT zoneid, name FROM zones").then((r) => setZones(new Map(r.map((z) => [z.zoneid, z.name]))));
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
    const t = setInterval(async () => setLiveRaw(await readLive()), 1000);
    return () => clearInterval(t);
  }, []);
  // Learned Blue Magic from the client -> our spell names, mirrored into user.db so it survives without the addon.
  useEffect(() => {
    if (!live?.bluKnown) { setLiveLearned(null); return; }
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
      case "friends": return <Friends />;
      case "settings": return <Settings />;
      case "map": return <LiveMap />;
      case "storage": return <Storage />;
    }
  })();

  const online = friends.filter((f) => f.char?.isOnline);

  return (
    <Ctx.Provider value={{ charId, char, owned: ownedAll, where, live, liveLearned, fetchedAt, stale, go, loadChar, friends, addFriend, removeFriend,
      refreshFriends: () => refreshFriends(true), zoneName: (id) => zones.get(id), toasts, setToasts, toast }}>
      <div className="shell">
        <nav>
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
