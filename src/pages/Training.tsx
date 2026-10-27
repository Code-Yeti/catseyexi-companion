import { useEffect, useState } from "react";
import { useApp } from "../ctx";
import { getKv, setKv } from "../db";
import { dhm, isTimedRoe, nextTimedRoe, parseTraining, timedRoe, type Count } from "../ffxi";

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
    </div>
  );
}
