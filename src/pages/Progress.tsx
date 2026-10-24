import { Fragment, useEffect, useState } from "react";
import { useApp } from "../ctx";
import { q, uq, uexec, getKv } from "../db";
import { JOBS, LEVEL_CAP, QUEST_AREAS, decodeLogs } from "../ffxi";

type Row = { item: string; note?: string; url?: string; done: boolean };

// Seeded lists come from bg-wiki (reference.db checklist_seed); your own lists live only in user.db.
export default function Progress() {
  const { char } = useApp();
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
    const seed = await q("SELECT item, note, url FROM checklist_seed WHERE list=$1 ORDER BY ord", list);
    const mine = await uq<{ item: string; done: number }>("SELECT item, done FROM checklist WHERE list=$1", list);
    const done = new Map(mine.map((m) => [m.item, !!m.done]));
    const seeded = new Set(seed.map((s: any) => s.item));
    setRows([...seed.map((s: any) => ({ ...s, done: done.get(s.item) ?? false })),
      ...mine.filter((m) => !seeded.has(m.item)).map((m) => ({ item: m.item, done: !!m.done }))]);
  };
  useEffect(() => { loadLists(); uq("SELECT count(*) c FROM blu_learned").then((r) => setBluCount(r[0].c)); }, []);
  useEffect(() => { load(); }, [list]);

  const toggle = async (r: Row) => { await uexec("INSERT OR REPLACE INTO checklist VALUES ($1,$2,$3)", list, r.item, r.done ? 0 : 1); load(); };
  const add = async () => { if (!newItem.trim()) return; await uexec("INSERT OR IGNORE INTO checklist VALUES ($1,$2,0)", list, newItem.trim()); setNewItem(""); load(); };
  const newList = async () => { const n = prompt("New list name:"); if (n) { await uexec("INSERT OR IGNORE INTO checklist VALUES ($1,'(delete me)',0)", n); await loadLists(); setList(n); } };

  const cw = char?.accountType === 1;
  const shown = rows.filter((r) => (!hideDone || !r.done) && (!(mineOnly && cw && list === "CatsEyeXI Quests") || /\bCW\b/.test(r.note ?? "")));
  const capped = char ? JOBS.filter((j) => (char.jobs[j] ?? 0) >= LEVEL_CAP).length : 0;

  return (
    <div>
      <h1>Progress</h1>
      <GameLog />
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
        <span className="muted">{rows.filter((r) => r.done).length}/{rows.length} done</span>
      </div>
      <table>
        <tbody>
          {shown.map((r) => (
            <tr key={r.item}>
              <td style={{ width: 30 }}><input type="checkbox" checked={r.done} onChange={() => toggle(r)} /></td>
              <td className={r.done ? "muted" : ""}>{r.url ? <a href={r.url} target="_blank">{r.item}</a> : r.item}</td>
              <td className="muted">{r.note}</td>
            </tr>
          ))}
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
function GameLog() {
  const { live, char } = useApp();
  const [saved, setSaved] = useState<{ char: string; ts: number; logs: Record<string, string> }>();
  const [qn, setQn] = useState<Map<string, string>>(new Map());
  const [mn, setMn] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<number>();
  useEffect(() => {
    q<{ log: number; id: number; name: string }>("SELECT * FROM quest_names").then((r) => setQn(new Map(r.map((x) => [x.log + ":" + x.id, x.name]))));
    q<{ log: number; id: number; name: string }>("SELECT * FROM mission_names").then((r) => setMn(new Map(r.map((x) => [x.log + ":" + x.id, x.name]))));
    getKv("gameLogs").then((v) => v && setSaved(JSON.parse(v))); // last log App saved, for when the game is closed
  }, []);
  const logs = live?.logs ?? (saved && (!char || saved.char === char.charname) ? saved.logs : undefined);
  if (!logs) return null;
  const d = decodeLogs(logs);
  if (!d.have && live) return <div className="card muted">The game addon is connected. Your quest log appears after the next zone change.</div>;
  const name = (log: number, id: number) => qn.get(log + ":" + id) ?? `Quest #${id}`;
  const mission = (log: number, id?: number) => (id === undefined ? "?" : mn.get(log + ":" + id) ?? (id === 0 ? "not started" : `#${id}`));
  return (
    <div className="card">
      <b>From the game</b> {live?.logs ? <span className="tag own">live</span>
        : <span className="tag">last read {new Date(saved!.ts * 1000).toLocaleString()}</span>}
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
