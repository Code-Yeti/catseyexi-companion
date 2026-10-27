import { useEffect, useState } from "react";
import { useApp } from "../ctx";
import { getKv } from "../db";
import { parseTraining, type Count } from "../ffxi";

const ago = (t: number) => {
  const m = Math.floor((Date.now() / 1000 - t) / 60);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};

function Bar({ c }: { c: Count }) {
  const done = c.done >= c.need;
  return (
    <tr className={done ? "muted" : undefined}>
      <td>{c.name}</td>
      <td><div className="trait-bar" style={{ width: 200 }}><div style={{ width: `${Math.min(100, (c.done / c.need) * 100)}%`, background: done ? "var(--good)" : "var(--accent)" }} /></div></td>
      <td>{c.done}/{c.need}</td>
      <td>{done ? <span className="good">Complete</span> : <span className="muted">{c.need - c.done} to go</span>}</td>
      <td className="muted">{ago(c.time)}</td>
    </tr>
  );
}

// Training: kill and collection progress the game prints in chat (training regimes, Records of Eminence, other
// "(n/m)" counts), captured by the addon and kept in user.db by App (kv "ventureLog"), so it shows with the game closed.
export default function Training() {
  const { live } = useApp();
  const [lines, setLines] = useState<{ text: string; time: number }[]>([]);
  useEffect(() => { getKv("ventureLog").then((v) => v && setLines(JSON.parse(v))); }, [live?.ventureLog?.length, live?.ts]);
  const t = parseTraining(lines);
  const table = (rows: Count[]) => <table style={{ marginTop: 6 }}><tbody>{rows.map((c) => <Bar key={c.name} c={c} />)}</tbody></table>;
  const empty = !t.regime && !t.roe.length && !t.other.length;
  return (
    <div>
      <h1>Training</h1>
      <p className="muted">Progress as the game reports it in chat, read by the game addon. An objective shows up after its first kill or item that counts.</p>
      {empty && <div className="card muted">Nothing yet. Defeat a training regime target or make progress on a Records of Eminence objective with the addon running.</div>}
      {t.regime && (
        <div className="card">
          <b>Training regime</b>{t.regime.complete && <span className="tag own">complete</span>}
          {table([t.regime])}
        </div>
      )}
      {t.roe.length > 0 && <div className="card"><b>Records of Eminence</b>{table(t.roe)}</div>}
      {t.other.length > 0 && <div className="card"><b>Other counts</b>{table(t.other)}</div>}
    </div>
  );
}
