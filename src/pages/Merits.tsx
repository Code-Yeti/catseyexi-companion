import { useEffect, useMemo, useState } from "react";
import { useApp } from "../ctx";
import { q, getKv, setKv } from "../db";
import { JOBS } from "../ffxi";

type Merit = { id: number; cat: string; cap: number; name: string; costs: string; ord: number };
type Have = { ts: number; have: Record<string, number>; held?: number; limit?: number };

const GENERAL: Record<string, string> = { hp_mp: "HP / MP", attributes: "Attributes", combat_skills: "Combat Skills", magic_skills: "Magic Skills", others: "Others" };
const LIMIT_PER_MERIT = 10_000;
const cost = (costs: number[], from: number, to: number) => costs.slice(from, to).reduce((a, b) => a + b, 0);

// Merit planner (LSB Lv75-era costs and caps, build-db seedMerits). What you have comes from the game addon (0x08C, sent on
// every zone-in), kept in kv "meritsHave" so it shows with the game closed; without it you can set it by hand. Goals: kv "meritGoals".
export default function Merits() {
  const { char, live } = useApp();
  const [merits, setMerits] = useState<Merit[]>([]);
  const [have, setHave] = useState<Have>({ ts: 0, have: {} });
  const [goal, setGoal] = useState<Record<string, number>>({});
  const [sel, setSel] = useState<string>();
  const [mode, setMode] = useState<"goal" | "have">("goal");
  useEffect(() => {
    q<Merit>("SELECT * FROM merits ORDER BY ord").then(setMerits);
    getKv("meritGoals").then((v) => v && setGoal(JSON.parse(v)));
  }, []);
  const liveKey = live?.merits ? JSON.stringify(live.merits) + live.exp?.merits + "/" + live.exp?.limit : "";
  useEffect(() => {
    if (live?.merits) {
      const h: Have = { ts: live.ts, have: live.merits, held: live.exp?.merits, limit: live.exp?.limit };
      setHave(h); setKv("meritsHave", JSON.stringify(h));
    } else getKv("meritsHave").then((v) => v && setHave(JSON.parse(v)));
  }, [liveKey]);
  const fromGame = have.ts > 0;
  const mj = JOBS[Number(char?.mjob) - 1];
  const shown = sel ?? (mj ? "job:" + mj : "hp_mp");

  const cats = useMemo(() => {
    const m = new Map<string, Merit[]>();
    for (const x of merits) m.set(x.cat, [...(m.get(x.cat) ?? []), x]);
    return m;
  }, [merits]);
  const catsFor = (s: string) => (s.startsWith("job:") ? [s.slice(4) + "_group_1", s.slice(4) + "_group_2"] : [s]).filter((c) => cats.has(c));
  const lvl = (x: Merit) => have.have[x.id] ?? 0;
  const tgt = (x: Merit) => Math.max(goal[x.id] ?? 0, lvl(x));
  const catCost = (c: string) => (cats.get(c) ?? []).reduce((a, x) => a + cost(x.costs.split(",").map(Number), lvl(x), tgt(x)), 0);
  const selCost = (s: string) => catsFor(s).reduce((a, c) => a + catCost(c), 0);
  const need = [...cats.keys()].reduce((a, c) => a + catCost(c), 0);
  const held = live?.exp?.merits ?? have.held ?? 0;
  const limit = live?.exp?.limit ?? have.limit ?? 0;
  const earn = Math.max(0, need - held);

  const saveGoal = (g: Record<string, number>) => { setGoal(g); setKv("meritGoals", JSON.stringify(g)); };
  const click = (x: Merit, n: number) => {
    if (mode === "goal") {
      const v = (goal[x.id] ?? 0) === n ? n - 1 : n;
      saveGoal({ ...goal, [x.id]: v });
      if (v < lvl(x)) setHaveManual({ ...have.have, [x.id]: v });
    } else {
      const v = lvl(x) === n ? n - 1 : n;
      setHaveManual({ ...have.have, [x.id]: v });
      if ((goal[x.id] ?? 0) < v) saveGoal({ ...goal, [x.id]: v });
    }
  };
  const setHaveManual = (h: Record<string, number>) => { const n = { ...have, have: h }; setHave(n); setKv("meritsHave", JSON.stringify(n)); };
  const clearGoals = () => { const g = { ...goal }; for (const c of catsFor(shown)) for (const x of cats.get(c)!) delete g[x.id]; saveGoal(g); };

  const tab = (s: string, label: string) => {
    const n = selCost(s);
    return <button key={s} className={shown === s ? "active-tab" : undefined} onClick={() => setSel(s)}>{label}{n > 0 && <span className="tag">{n}</span>}</button>;
  };

  return (
    <div>
      <h1>Merits</h1>
      <div className="muted">
        {live?.merits ? <>Your merits, read from the game<span className="tag own">live</span></>
          : fromGame ? <>Your merits as of {new Date(have.ts * 1000).toLocaleString()}, from the game addon.</>
          : "Load the game addon and zone once to read your merits. Until then, set what you have by hand."}
        {" "}Costs and caps are the Lv75-era ones from LandSandBoat.
      </div>
      <div className="card row" style={{ gap: 28 }}>
        <div><div className="muted">Merit points needed</div><b style={{ fontSize: 22 }} className="warn">{need}</b></div>
        <div><div className="muted">Merits on hand</div><b style={{ fontSize: 22 }}>{held}{live?.exp && <span className="muted"> / {live.exp.meritsMax}</span>}</b></div>
        <div><div className="muted">Still to earn</div><b style={{ fontSize: 22 }}>{earn}</b></div>
        <div><div className="muted">Limit points to go</div><b style={{ fontSize: 22 }}>{Math.max(0, earn * LIMIT_PER_MERIT - (earn ? limit : 0)).toLocaleString()}</b></div>
      </div>
      <div className="row">{Object.entries(GENERAL).map(([k, v]) => tab(k, v))}</div>
      <div className="row">{JOBS.filter((j) => cats.has(j + "_group_1")).map((j) => tab("job:" + j, j.toUpperCase()))}</div>
      <div className="row">
        <span className="muted">Clicking a dot sets your</span>
        <button className={mode === "goal" ? "active-tab" : undefined} onClick={() => setMode("goal")}>Goal</button>
        <button className={mode === "have" ? "active-tab" : undefined} onClick={() => setMode("have")} title={fromGame ? "The game addon overwrites this on your next zone" : undefined}>Current</button>
        <button onClick={clearGoals}>Clear goals here</button>
      </div>
      {catsFor(shown).map((c) => {
        const list = cats.get(c)!, used = list.reduce((a, x) => a + tgt(x), 0), cap = list[0].cap;
        return (
          <div key={c} className="card">
            <div className="row" style={{ justifyContent: "space-between", margin: 0 }}>
              <b>{GENERAL[c] ?? `${c.slice(0, 3).toUpperCase()} Group ${c.slice(-1)}`}</b>
              <span className={used > cap ? "bad" : "muted"}>Upgrades {used} / {cap}{used > cap && ` · ${used - cap} over the category cap`}</span>
            </div>
            <table>
              <thead><tr><th>Merit</th><th>Level</th><th>Next</th><th>Cost</th></tr></thead>
              <tbody>
                {list.map((x) => {
                  const costs = x.costs.split(",").map(Number), h = lvl(x), g = tgt(x), n = cost(costs, h, g);
                  return (
                    <tr key={x.id}>
                      <td>{x.name}</td>
                      <td>
                        <span className="pips">{costs.map((_, i) => (
                          <button key={i} className={"pip" + (i < h ? " have" : i < g ? " goal" : "")} onClick={() => click(x, i + 1)} title={`Level ${i + 1}`} />
                        ))}</span>
                        <span className="muted"> {h}{g > h && "→" + g}/{costs.length}</span>
                      </td>
                      <td className="muted">{h < costs.length ? costs[h] : "max"}</td>
                      <td className={n ? "warn" : "muted"}>{n || "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      <div className="muted">One merit point is {LIMIT_PER_MERIT.toLocaleString()} limit points. A category's cap counts every merit in it together. Green dots are upgrades you have, yellow ones are your goal.</div>
    </div>
  );
}
