import { useEffect, useMemo, useState } from "react";
import { useApp } from "../ctx";
import { q, getKv, setKv } from "../db";
import { wikiUrl } from "../ffxi";

type Trust = { name: string; jobs: string; role: string; ace: number; cw: number; obtain: string; customized: number; notes: string | null; spellid: number | null };

// Trusts on CatseyeXI (bg-wiki CatsEyeXI_Systems/Trusts). Which ones you know comes from the game addon (trustKnown),
// kept in kv "trustKnown" so it still shows with the game closed.
export default function Trusts() {
  const { char, live } = useApp();
  const [trusts, setTrusts] = useState<Trust[]>([]);
  const [known, setKnown] = useState<Set<number> | null>(null);
  const [filter, setFilter] = useState({ text: "", role: "", hideKnown: false, mine: true });
  useEffect(() => { q<Trust>("SELECT * FROM trusts ORDER BY role, name").then(setTrusts); }, []);
  useEffect(() => {
    if (live?.trustKnown) { setKnown(new Set(live.trustKnown)); setKv("trustKnown", JSON.stringify(live.trustKnown)); }
    else getKv("trustKnown").then((v) => v && setKnown(new Set(JSON.parse(v))));
  }, [live?.trustKnown?.join()]);
  const cw = char?.accountType === 1;
  const roles = useMemo(() => [...new Set(trusts.map((t) => t.role))], [trusts]);
  const has = (t: Trust) => t.spellid != null && !!known?.has(t.spellid);
  const forMe = (t: Trust) => (cw ? t.cw : t.ace);
  const text = filter.text.toLowerCase();
  const shown = trusts.filter((t) => (!filter.role || t.role === filter.role) && (!filter.hideKnown || !has(t)) && (!filter.mine || !char || forMe(t)) &&
    (t.name + " " + t.jobs).toLowerCase().includes(text));
  const mine = trusts.filter((t) => !char || forMe(t));

  return (
    <div>
      <h1>Trusts</h1>
      <div className="muted">
        {known ? <>You have {mine.filter(has).length}/{mine.length}{live?.trustKnown && <span className="tag own">from game</span>}</> : "Run the game addon once to see which trusts you have."}
        {" · "}<a href={wikiUrl("CatsEyeXI_Systems/Trusts")} target="_blank">bg-wiki: CatsEyeXI Trusts</a>
      </div>
      <div className="row">
        <input placeholder="Filter by name or job" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
        <select value={filter.role} onChange={(e) => setFilter({ ...filter, role: e.target.value })}>
          <option value="">All roles</option>
          {roles.map((r) => <option key={r}>{r}</option>)}
        </select>
        {known && <label><input type="checkbox" checked={filter.hideKnown} onChange={(e) => setFilter({ ...filter, hideKnown: e.target.checked })} /> Hide ones I have</label>}
        {char && <label><input type="checkbox" checked={filter.mine} onChange={(e) => setFilter({ ...filter, mine: e.target.checked })} /> Only {cw ? "Crystal Warrior" : "ACE"}</label>}
      </div>
      <table>
        <thead><tr><th></th><th>Trust</th><th>Job</th><th>Role</th><th>How to get it</th><th>Notes</th></tr></thead>
        <tbody>
          {shown.map((t) => (
            <tr key={t.name} className={has(t) ? "muted" : undefined}>
              <td>{has(t) ? <span className="good" title="You have it">✔</span> : ""}</td>
              <td>{t.name}{!!t.customized && <span className="tag cx" title="Changed on CatseyeXI">CX</span>}
                <div>{!!t.ace && <span className="tag">ACE</span>}{!!t.cw && <span className="tag">CW</span>}</div></td>
              <td>{t.jobs}</td>
              <td className="muted">{t.role}</td>
              <td style={{ whiteSpace: "pre-line" }}>{t.obtain}</td>
              <td className="muted" style={{ whiteSpace: "pre-line" }}>{t.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
