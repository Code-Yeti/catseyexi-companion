import { Fragment, useEffect, useState } from "react";
import { useApp } from "../ctx";
import { q, uq, uexec, getKv } from "../db";
import { JOBS, LEVEL_CAP, QUEST_AREAS, decodeLogs, pretty, parseVentures } from "../ffxi";
import type { Trial } from "../live";
import ItemIcon from "../components/ItemIcon";

type Row = { item: string; note?: string; url?: string; done: boolean; log?: number | null; mid?: number | null };
type Saved = { char: string; ts: number; logs: Record<string, string> };

// Game log -> is this LSB mission done? Nation and Zilart missions have "completed" bits; the later storylines only
// report the current mission, and LSB numbers them in story order, so everything before it is done.
function missionState(d: ReturnType<typeof decodeLogs>, log: number, mid: number): "done" | "current" | "todo" | undefined {
  const cur = !d.current ? undefined : ({ 3: d.current.zilart, 4: d.current.toau, 5: d.current.wotg, 6: d.current.cop } as Record<number, number | undefined>)[log];
  const nationCur = d.current && log === d.current.nation ? d.current.nationMission : undefined;
  if (mid === cur || mid === nationCur) return "current";
  if (log <= 3) return d.missionsDone.some((m) => m.log === log && m.id === mid) || (cur !== undefined && mid < cur) ? "done" : "todo";
  return cur === undefined ? undefined : mid < cur ? "done" : "todo";
}

// Seeded lists come from bg-wiki (reference.db checklist_seed); your own lists live only in user.db.
export default function Progress() {
  const { char, live } = useApp();
  const [saved, setSaved] = useState<Saved>();
  const [lists, setLists] = useState<string[]>([]);
  const [list, setList] = useState<string>("CatsEyeXI Quests");
  const [rows, setRows] = useState<Row[]>([]);
  const [hideDone, setHideDone] = useState(false);
  const [mineOnly, setMineOnly] = useState(true);
  const [newItem, setNewItem] = useState("");
  const [bluCount, setBluCount] = useState(0);

  const loadLists = async () => {
    const seeded = (await q("SELECT DISTINCT list FROM checklist_seed")).map((r: any) => r.list);
    const own = (await uq("SELECT DISTINCT list FROM checklist")).map((r: any) => r.list);
    setLists([...new Set([...seeded, ...own])]);
  };
  const load = async () => {
    const seed = await q("SELECT item, note, url, log, mid FROM checklist_seed WHERE list=$1 ORDER BY ord", list);
    const mine = await uq<{ item: string; done: number }>("SELECT item, done FROM checklist WHERE list=$1", list);
    const done = new Map(mine.map((m) => [m.item, !!m.done]));
    const seeded = new Set(seed.map((s: any) => s.item));
    setRows([...seed.map((s: any) => ({ ...s, done: done.get(s.item) ?? false })),
      ...mine.filter((m) => !seeded.has(m.item)).map((m) => ({ item: m.item, done: !!m.done }))]);
  };
  useEffect(() => {
    loadLists(); uq("SELECT count(*) c FROM blu_learned").then((r) => setBluCount(r[0].c));
    getKv("gameLogs").then((v) => v && setSaved(JSON.parse(v))); // last log App saved, for when the game is closed
  }, []);
  const logs = live?.logs ?? (saved && (!char || saved.char === char.charname) ? saved.logs : undefined);
  const game = logs ? decodeLogs(logs) : undefined;
  const state = (r: Row) => (game?.have && r.log != null && r.mid != null ? missionState(game, r.log, r.mid) : undefined);
  const isDone = (r: Row) => { const st = state(r); return st ? st === "done" : r.done; };
  useEffect(() => { load(); }, [list]);

  const toggle = async (r: Row) => { await uexec("INSERT OR REPLACE INTO checklist VALUES ($1,$2,$3)", list, r.item, r.done ? 0 : 1); load(); };
  const add = async () => { if (!newItem.trim()) return; await uexec("INSERT OR IGNORE INTO checklist VALUES ($1,$2,0)", list, newItem.trim()); setNewItem(""); load(); };
  const newList = async () => { const n = prompt("New list name:"); if (n) { await uexec("INSERT OR IGNORE INTO checklist VALUES ($1,'(delete me)',0)", n); await loadLists(); setList(n); } };

  const cw = char?.accountType === 1;
  const shown = rows.filter((r) => (!hideDone || !isDone(r)) && (!(mineOnly && cw && list === "CatsEyeXI Quests") || /\bCW\b/.test(r.note ?? "")));
  const capped = char ? JOBS.filter((j) => (char.jobs[j] ?? 0) >= LEVEL_CAP).length : 0;

  return (
    <div>
      <h1>Progress</h1>
      {logs && <GameLog logs={logs} saved={live?.logs ? undefined : saved} />}
      <WsTrials />
      <Ventures />
      {char && (
        <div className="row">
          <div className="job">Jobs at {LEVEL_CAP}<b>{capped}/22</b></div>
          <div className="job">Blue spells<b>{bluCount}</b></div>
          <div className="job">Merits<b>{char.exp.merits ?? 0}</b></div>
          <div className="job">Rank<b>{[char.rank_sandoria, char.rank_bastok, char.rank_windurst][char.nation]}</b></div>
        </div>
      )}
      <div className="row">
        <select value={list} onChange={(e) => setList(e.target.value)}>{lists.map((l) => <option key={l}>{l}</option>)}</select>
        <button onClick={newList}>+ New list</button>
        <label><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide done</label>
        {cw && list === "CatsEyeXI Quests" && <label><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Only Crystal Warrior quests</label>}
        <span className="muted">{rows.filter(isDone).length}/{rows.length} done</span>
      </div>
      <table>
        <tbody>
          {shown.map((r) => {
            const st = state(r), done = isDone(r);
            return (
              <tr key={r.item}>
                <td style={{ width: 30 }}><input type="checkbox" checked={done} disabled={!!st} title={st ? "From the game" : undefined} onChange={() => toggle(r)} /></td>
                <td className={done ? "muted" : ""}>{r.url ? <a href={r.url} target="_blank">{r.item}</a> : r.item}
                  {st === "current" && <span className="tag warn">current</span>}</td>
                <td className="muted">{r.note}{st && <span className="tag own">from game</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add item to this list" onKeyDown={(e) => e.key === "Enter" && add()} />
        <button onClick={add}>Add</button>
      </div>
    </div>
  );
}

// Quest and mission log read from the game by the catseyecompanion addon (names from LandSandBoat's quest ids, so
// CatseyeXI's custom quests show by number only).
const MISSION_LOG_NAMES = ["San d'Oria", "Bastok", "Windurst", "Zilart"];
function GameLog({ logs, saved }: { logs: Record<string, string>; saved?: Saved }) {
  const { live } = useApp();
  const [qn, setQn] = useState<Map<string, string>>(new Map());
  const [mn, setMn] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<number>();
  useEffect(() => {
    q<{ log: number; id: number; name: string }>("SELECT * FROM quest_names").then((r) => setQn(new Map(r.map((x) => [x.log + ":" + x.id, x.name]))));
    q<{ log: number; id: number; name: string }>("SELECT * FROM mission_names").then((r) => setMn(new Map(r.map((x) => [x.log + ":" + x.id, x.name]))));
  }, []);
  const d = decodeLogs(logs);
  if (!d.have && live) return <div className="card muted">The game addon is connected. Your quest log appears after the next zone change.</div>;
  const name = (log: number, id: number) => qn.get(log + ":" + id) ?? `Quest #${id}`;
  const mission = (log: number, id?: number) => (id === undefined ? "?" : id === 65535 ? "no mission active" : mn.get(log + ":" + id) ?? (id === 0 ? "not started" : `#${id}`));
  return (
    <div className="card">
      <b>From the game</b> {saved ? <span className="tag">last read {new Date(saved.ts * 1000).toLocaleString()}</span> : <span className="tag own">live</span>}
      {d.current && (
        <div className="muted" style={{ marginTop: 4 }}>
          Current: {MISSION_LOG_NAMES[d.current.nation]} <b>{mission(d.current.nation, d.current.nationMission)}</b> ·
          Zilart <b>{mission(3, d.current.zilart)}</b> · CoP <b>{mission(6, d.current.cop)}</b>
          {d.current.toau !== undefined && <> · ToAU <b>{mission(4, d.current.toau)}</b></>}
          {d.current.wotg !== undefined && <> · WotG <b>{mission(5, d.current.wotg)}</b></>}
        </div>
      )}
      {d.missionsDone.length > 0 && <div className="muted">Missions completed: {MISSION_LOG_NAMES.map((n, log) => `${n} ${d.missionsDone.filter((m) => m.log === log).length}`).join(" · ")}</div>}
      <table style={{ marginTop: 6 }}>
        <tbody>
          {QUEST_AREAS.map((area, log) => {
            const list = d.quests.filter((x) => x.log === log);
            if (!list.length) return null;
            const active = list.filter((x) => !x.done);
            return (
              <Fragment key={area}>
                <tr className="click" onClick={() => setOpen(open === log ? undefined : log)}>
                  <td>{area}</td><td className="muted">{list.length - active.length} done</td>
                  <td>{active.length ? <span className="warn">{active.length} active</span> : ""}</td>
                </tr>
                {open === log && (
                  <tr><td colSpan={3}>
                    {active.map((x) => <div key={x.id} className="warn">● {name(log, x.id)}</div>)}
                    {list.filter((x) => x.done).map((x) => <div key={x.id} className="muted">✓ {name(log, x.id)}</div>)}
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Weapon skill trials: progress of the trial weapon(s) you have equipped right now; hidden otherwise.
function WsTrials() {
  const { live } = useApp();
  const [saved, setSaved] = useState<Record<string, Trial>>({});
  const [names, setNames] = useState<Map<number, string>>(new Map());
  useEffect(() => { getKv("wsTrials").then((v) => v && setSaved(JSON.parse(v))); }, [live?.ts]); // App updates it as you fight
  // Only trial weapons you have equipped right now (the addon reports main, sub and ranged).
  const ids = Object.keys(saved).map(Number).filter((id) => live?.weapons?.some((w) => w.id === id));
  useEffect(() => {
    if (ids.length) q<{ itemid: number; name: string }>(`SELECT itemid, name FROM item_basic WHERE itemid IN (${ids.join(",")})`)
      .then((r) => setNames(new Map(r.map((x) => [x.itemid, pretty(x.name)]))));
  }, [ids.join(",")]);
  if (!ids.length) return null;
  return (
    <div className="card">
      <b>Weapon skill trials</b> <span className="muted">· weapon skills on mobs that give EXP count (5 points, more if you close a skillchain).
        The weapon's own count only updates when you zone; "~" is the app's count since then.</span>
      <table style={{ marginTop: 6 }}><tbody>
        {ids.map((id) => {
          const t = saved[id], extra = t.extra ?? 0, pts = t.points + extra, done = pts >= t.need;
          return (
            <tr key={id}>
              <td style={{ width: 220 }}><ItemIcon id={id} />{names.get(id) ?? `#${id}`}</td>
              <td><div className="trait-bar" style={{ width: 220 }}><div style={{ width: `${Math.min(100, (pts / t.need) * 100)}%`, background: done ? "var(--good)" : "var(--accent)" }} /></div></td>
              <td title={extra ? "The weapon's own count updates when you zone; the rest is the app's count of your weapon skills since" : undefined}>
                {extra ? <>{t.points} + ~{extra}</> : pts}/{t.need}</td>
              <td>{done ? <span className="good">Complete: take it back to the quest NPC</span> : <span className="muted">{t.need - pts} to go</span>}</td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}

// Ventures (CatseyeXI): today's objectives, parsed from the last "!ventures" reply the addon captured.
function Ventures() {
  const { live } = useApp();
  const [lines, setLines] = useState<{ text: string; time: number }[]>([]);
  useEffect(() => { getKv("ventureLog").then((v) => v && setLines(JSON.parse(v))); }, [live?.ventureLog?.length, live?.ts]);
  const v = parseVentures(lines);
  const lvl = live?.mainLevel ?? 0;
  const tiers = [...new Set(v?.tiers.map((t) => t.lo))];
  const cell = (pool: "A" | "B", lo: number) => {
    const t = v!.tiers.find((x) => x.pool === pool && x.lo === lo);
    return t ? <td>{t.zone}{t.pct != null && <span className="muted"> · boss {t.pct}%</span>}</td> : <td />;
  };
  return (
    <div className="card">
      <b>Ventures</b> <span className="muted">· type <code>!ventures</code> in game (with the addon running) to refresh. Boss % is the zone's shared progress to its venture boss.</span>
      {v ? (
        <>
          <div className="muted" style={{ marginTop: 4 }}>As of {new Date(v.time * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</div>
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>Level</th><th>Pool A</th><th>Pool B</th></tr></thead>
            <tbody>
              {tiers.map((lo) => {
                const hi = v.tiers.find((t) => t.lo === lo)!.hi;
                return <tr key={lo} className={lvl >= lo && lvl <= hi ? "current" : undefined}><td>{lo}-{hi}</td>{cell("A", lo)}{cell("B", lo)}</tr>;
              })}
            </tbody>
          </table>
          {v.hvnm && <div style={{ marginTop: 6 }}><b>HVNM:</b> {v.hvnm.nm} in {v.hvnm.zone}{v.hvnm.pct != null && <span className="muted"> · {v.hvnm.pct}%</span>}</div>}
        </>
      ) : <div className="muted" style={{ marginTop: 4 }}>Nothing yet.</div>}
      {lines.length > 0 && (
        <details style={{ marginTop: 6 }}><summary className="muted">Venture chat</summary>
          <div className="venture-log">
            {lines.slice(-25).reverse().map((l, i) => (
              <div key={i}><span className="muted">{new Date(l.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> {l.text}</div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
