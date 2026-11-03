import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../ctx";
import ExpBar from "../components/ExpBar";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { getKv, setKv, q } from "../db";
import { conBand, dhm, isTimedRoe, jobName, levelSpots, nextTimedRoe, parseTraining, timedRoe, type Count, type SpotMob } from "../ffxi";

const ago = (t: number) => {
  const m = Math.floor((Date.now() / 1000 - t) / 60);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};

function Bar({ c, remove }: { c: Count; remove?: () => void }) {
  const done = c.done >= c.need;
  return (
    <tr className={done ? "muted" : undefined}>
      <td>{c.name}</td>
      <td><div className="trait-bar" style={{ width: 200 }}><div style={{ width: `${Math.min(100, (c.done / c.need) * 100)}%`, background: done ? "var(--good)" : "var(--accent)" }} /></div></td>
      <td>{c.done}/{c.need}</td>
      <td>{done ? <span className="good">Complete</span> : <span className="muted">{c.need - c.done} to go</span>}</td>
      <td title="Reward from the latest completion">{c.reward && <span className="good">+{c.reward}</span>}</td>
      <td className="muted">{ago(c.time)}</td>
      <td>{remove && <button onClick={remove} title="Hide until it makes progress again">Remove</button>}</td>
    </tr>
  );
}

const cap = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());
// Sleep / silence warning for a mob (from its TP moves and spells in LSB).
function Risk({ m }: { m: { sleeps: string | null; silences: string | null } }) {
  return <>
    {m.sleeps && <span className="warn" title={cap(m.sleeps)}> ⚠ sleep</span>}
    {m.silences && <span className="warn" title={cap(m.silences)}> ⚠ silence</span>}
  </>;
}

type RegimeRow = { type: string; id: number; zoneid: number; zone: string; lo: number; hi: number; counts: string; reward: number; targets: string | null };

// Where to level: zones and Fields/Grounds of Valor regimes in the right con band for your level. Prestige mode
// (kv "prestige" = the main job it was turned on for; App clears it on a job change) means 2 trusts and reduced EXP.
function LevelSpots() {
  const { char } = useApp();
  const job = String(char?.mjob ?? ""), lvl = Number(char?.mlvl ?? 0);
  const [prestigeJob, setPrestigeJob] = useState<string | null>(null);
  useEffect(() => { getKv("prestige").then((v) => setPrestigeJob(v ?? "")); }, [job]);
  const prestige = !!job && prestigeJob === job;
  const toggle = () => { const v = prestige ? "" : job; setPrestigeJob(v); setKv("prestige", v); };
  const [mobs, setMobs] = useState<SpotMob[]>([]);
  const [regimes, setRegimes] = useState<RegimeRow[]>([]);
  const { dc, vt } = conBand(lvl || 1), top = lvl + (prestige ? vt - 1 : vt);
  useEffect(() => {
    if (!lvl) return;
    q<SpotMob>(`SELECT m.zoneid, m.zone, m.name, coalesce(m.cx_lo, m.lo) lo, coalesce(m.cx_hi, m.hi) hi, m.n, m.aggro, m.sleeps, m.silences
      FROM mob_index m JOIN zone_settings z ON z.zoneid = m.zoneid WHERE m.era = 1 AND z.zonetype IN (2, 4) AND coalesce(m.cx_hi, m.hi) >= $1`, lvl + dc).then(setMobs);
    // targets: name|sleeps|silences per regime target, resolved in its zone
    q<RegimeRow>(`SELECT r.type, r.id, r.zoneid, z.name zone, r.lo, r.hi, r.counts, r.reward,
        group_concat(DISTINCT m.name || '|' || replace(coalesce(m.sleeps, ''), ',', ', ') || '|' || replace(coalesce(m.silences, ''), ',', ', ')) targets
      FROM regimes r JOIN zones z ON z.zoneid = r.zoneid LEFT JOIN regime_targets t ON t.type = r.type AND t.id = r.id
      LEFT JOIN mob_index m ON m.mobname = t.mobname AND m.zoneid = t.zoneid
      WHERE r.lo >= $1 AND r.hi <= $2 GROUP BY r.type, r.id ORDER BY r.hi DESC, r.reward DESC`, lvl + dc, top).then(setRegimes);
  }, [lvl, prestige]);
  const spots = levelSpots(mobs, lvl, prestige);
  const byZone = new Map(spots.map((s) => [s.zoneid, s]));
  // Every regime zone around Lv50 has some aggressive Very Tough mob, so they're flagged rather than dropped; in prestige
  // mode the zones without one come first.
  const risky = (r: RegimeRow) => (byZone.get(r.zoneid)?.danger.length ? 1 : 0);
  const shownRegimes = (prestige ? [...regimes].sort((a, b) => risky(a) - risky(b)) : regimes).slice(0, 10);
  const okSpots = spots.filter((s) => s.ok).slice(0, 8);
  // Top 3 of each list, the rest behind a toggle row (in the same table, so the columns stay aligned).
  const [more, setMore] = useState({ spots: false, regimes: false });
  // The whole card folds to its header (kv "levelSpotsOpen"), closed by default so the progress above stays the focus.
  const [open, setOpen] = useState(false);
  useEffect(() => { getKv("levelSpotsOpen").then((v) => setOpen(v === "1")); }, []);
  const flip = () => { setOpen(!open); setKv("levelSpotsOpen", open ? "0" : "1"); };
  const fold = <T,>(rows: T[], k: keyof typeof more, cols: number, row: (r: T) => ReactNode) => <>
    {(more[k] ? rows : rows.slice(0, 3)).map(row)}
    {rows.length > 3 && <tr className="click muted" onClick={() => setMore({ ...more, [k]: !more[k] })}>
      <td colSpan={cols}>{more[k] ? "▾ Show fewer" : `▸ ${rows.length - 3} more`}</td></tr>}
  </>;
  if (!char) return null;
  const lv = (m: { lo: number; hi: number }) => m.lo === m.hi ? `${m.lo}` : `${m.lo}-${m.hi}`;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b onClick={flip} style={{ cursor: "pointer" }} title={open ? "Hide" : "Show leveling suggestions"}>{open ? "▾" : "▸"} Where to level · {jobName(job)}{lvl}</b>
        <label title="Prestige: level reset to 1, reduced EXP, 2 trusts. Turns off by itself when you change main job.">
          <input type="checkbox" checked={prestige} onChange={toggle} /> Prestige mode
        </label>
      </div>
      {open && <><div className="muted">
        {prestige ? "Prestige: 2 trusts, so targets up to Tough, and zones with aggressive Very Tough mobs are left out."
          : "Full party of 5 trusts: targets from Decent Challenge up to Very Tough."} Mobs that sleep or silence are flagged; avoid them where you can.
      </div>
      <table style={{ marginTop: 6 }}>
        <thead><tr><th>Zone</th><th>Targets (lv)</th><th>Watch out</th></tr></thead>
        <tbody>
          {fold(okSpots, "spots", 3, (s) => (
            <tr key={s.zoneid}>
              <td>{s.zone}</td>
              <td>{s.targets.sort((a, b) => b.n - a.n).slice(0, 6).map((m, i) => <span key={m.name}>{i > 0 && ", "}{m.name} <span className="muted">{lv(m)}</span><Risk m={m} /></span>)}</td>
              <td>{s.danger.length > 0 && <span className="warn" title={s.danger.map((m) => `${m.name} ${lv(m)}`).join(", ")}>Aggressive Very Tough+ ({s.danger.length})</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!spots.some((s) => s.ok) && <div className="muted">No zone fits this level.</div>}
      {shownRegimes.length > 0 && <>
        <div style={{ marginTop: 10 }}><b>Training regimes</b> <span className="muted">Fields / Grounds of Valor pages whose targets are lv{lvl + dc}-{top}</span></div>
        <table style={{ marginTop: 6 }}>
          <tbody>
            {fold(shownRegimes, "regimes", 7, (r) => {
              const t = (r.targets ?? "").split(/,(?! )/).filter(Boolean).map((x) => { const [name, sleeps, silences] = x.split("|"); return { name, sleeps: sleeps || null, silences: silences || null }; });
              return (
                <tr key={r.type + r.id}>
                  <td>{r.zone}</td>
                  <td><span className="tag">{r.type}</span></td>
                  <td className="muted">lv{lv(r)}</td>
                  <td>{t.map((m, i) => <span key={m.name}>{i > 0 && ", "}{m.name}<Risk m={m} /></span>)}{!t.length && <span className="muted">kill {r.counts}</span>}</td>
                  <td className="muted" title="Kills needed per target">{r.counts.replace(/,/g, "/")}</td>
                  <td className="muted">{r.reward} {r.type === "FoV" ? "gil" : "tabs"}</td>
                  <td>{byZone.get(r.zoneid)?.danger.length ? <span className="warn">Very Tough aggro in zone</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>}
      </>}
    </div>
  );
}

// Status effects on you, from the addon, counting down between its writes. Shortest timer first, untimed last.
function Buffs() {
  const { live } = useApp();
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => { const i = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(i); }, []);
  const buffs = [...(live?.buffs ?? [])].sort((a, b) => (a[2] || Infinity) - (b[2] || Infinity));
  if (!live) return null;
  // Icons the addon saved from the game (icons\<id>.bmp); the name shows instead until one exists.
  const [dir, setDir] = useState("");
  useEffect(() => { appDataDir().then(setDir); }, []);
  const [noIcon, setNoIcon] = useState<Set<number>>(new Set());
  const left = (t: number) => { const s = Math.max(0, Math.round(t - now)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`; };
  return (
    <div className="card">
      <b>Buffs</b>
      {buffs.length ? <div className="buffs">{buffs.map(([id, name, t], i) => (
        <span key={id + "-" + i} className={t && t - now < 30 ? "warn" : undefined} title={name || `#${id}`}>
          {dir && !noIcon.has(id)
            ? <img src={convertFileSrc(`${dir}\\icons\\${id}.bmp`)} alt={name} onError={() => setNoIcon(new Set(noIcon).add(id))} />
            : name || `#${id}`}
          {t > 0 && <small>{left(t)}</small>}
        </span>
      ))}</div> : <div className="muted">None.</div>}
    </div>
  );
}

// Training: kill and collection progress the game prints in chat (training regimes, Records of Eminence, other
// "(n/m)" counts), captured by the addon and kept in user.db by App (kv "ventureLog"), so it shows with the game closed.
export default function Training() {
  const { live } = useApp();
  const [lines, setLines] = useState<{ text: string; time: number; mob?: string }[]>([]);
  useEffect(() => { getKv("ventureLog").then((v) => v && setLines(JSON.parse(v))); }, [live?.ventureLog?.length, live?.ts]);
  // Removed objectives (kv "trainingHidden", name -> time of the progress line they were removed at): hidden until a newer
  // progress line, so a rotating objective comes back when it shows up again.
  const [hidden, setHidden] = useState<Record<string, number>>({});
  useEffect(() => { getKv("trainingHidden").then((v) => v && setHidden(JSON.parse(v))); }, []);
  const hide = (c: Count) => { const h = { ...hidden, [c.name]: c.time }; setHidden(h); setKv("trainingHidden", JSON.stringify(h)); };
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);
  const timed = timedRoe(now), gains = nextTimedRoe("Gain Experience", now);
  const t = parseTraining(lines);
  // Limited-time challenges last one 4h block: progress from an earlier block is gone in game, so hide it here too.
  t.roe = t.roe.filter((c) => !(c.time <= hidden[c.name]) && !(isTimedRoe(c.name) && c.time * 1000 < timed.start));
  t.other = t.other.filter((c) => !(c.time <= hidden[c.name]));
  const table = (rows: Count[], removable = false) =>
    <table style={{ marginTop: 6 }}><tbody>{rows.map((c) => <Bar key={c.name} c={c} remove={removable ? () => hide(c) : undefined} />)}</tbody></table>;
  const empty = !t.regime && !t.roe.length && !t.other.length;
  return (
    <div>
      <h1>Training</h1>
      <p className="muted">Progress as the game reports it in chat, read by the game addon. An objective shows up after its first kill or item that counts.</p>
      <ExpBar big />
      <Buffs />
      {empty && <div className="card muted">Nothing yet. Defeat a training regime target or make progress on a Records of Eminence objective with the addon running.</div>}
      {t.regime && (
        <div className="card">
          <b>Training regime</b>{t.regime.complete && <span className="tag own">complete</span>}
          {t.regime.reward && <span className="muted" title="Reward from the latest completion"> · reward +{t.regime.reward}</span>}
          {table(t.regime.targets)}
        </div>
      )}
      <div className="card">
        <b>Records of Eminence</b>
        <div className="muted" style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span>Limited-time challenge: <b>{timed.name}</b>, ends in {dhm(timed.end - now)} · up next: <b>{timedRoe(timed.end).name}</b></span>
          {timed.name !== "Gain Experience" && gains && <span>Next Gain Experience in <b>{dhm(gains - now)}</b></span>}
        </div>
        {t.roe.length > 0 && table(t.roe, true)}
      </div>
      {t.other.length > 0 && <div className="card"><b>Other counts</b>{table(t.other, true)}</div>}
      <LevelSpots />
    </div>
  );
}
