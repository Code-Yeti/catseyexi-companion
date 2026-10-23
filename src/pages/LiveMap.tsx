import { useEffect, useMemo, useState } from "react";
import { useApp } from "../ctx";
import { q, uq } from "../db";
import { pretty } from "../ffxi";
import ZoneMap, { type Pt } from "../components/ZoneMap";

type Mob = { mobname: string; lo: number; hi: number; aggro: number; links: number; blu: string | null; n: number };
type Filter = "unlearned" | "near" | "all";

// The zone you're in right now (addon; else catseyexi.com's last position), with its mobs' spawns.
export default function LiveMap() {
  const { live, char, liveLearned, zoneName, go } = useApp();
  const zoneid = live?.zone ?? char?.pos_zone;
  const myLevel = live?.mainLevel ?? (char ? Number(char.mlvl) : 0);
  const [mobs, setMobs] = useState<Mob[]>([]);
  const [spawns, setSpawns] = useState<{ mobname: string; x: number; z: number }[]>([]);
  const [learned, setLearned] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("unlearned");
  const [pick, setPick] = useState<string>();

  useEffect(() => {
    if (zoneid == null) return;
    setPick(undefined);
    q<Mob>(`SELECT mobname, coalesce(cx_lo, lo) lo, coalesce(cx_hi, hi) hi, aggro, links, blu, n FROM mob_index
            WHERE zoneid=$1 AND era=1 ORDER BY lo, mobname`, zoneid).then(setMobs);
    q<{ mobname: string; x: number; z: number }>("SELECT mobname, x, z FROM spawns WHERE zoneid=$1", zoneid).then(setSpawns);
  }, [zoneid]);
  useEffect(() => {
    if (liveLearned) setLearned(liveLearned);
    else uq<{ name: string }>("SELECT name FROM blu_learned").then((r) => setLearned(new Set(r.map((x) => x.name))));
  }, [liveLearned]);

  const unlearned = (m: Mob) => (m.blu?.split(", ") ?? []).filter((s) => !learned.has(s));
  const shown = useMemo(() => mobs.filter((m) =>
    filter === "all" ? true : filter === "near" ? m.hi >= myLevel - 8 && m.lo <= myLevel + 5 : unlearned(m).length > 0), [mobs, filter, learned, myLevel]);
  const pts: Pt[] = useMemo(() => {
    const names = new Set((pick ? shown.filter((m) => m.mobname === pick) : shown).map((m) => m.mobname));
    return spawns.filter((s) => names.has(s.mobname)).map((s) => ({ x: s.x, z: s.z, label: pretty(s.mobname) }));
  }, [spawns, shown, pick]);

  if (zoneid == null) return <div><h1>Map</h1><p className="muted">Load your character, or connect the game addon, to see where you are.</p></div>;

  return (
    <div>
      <h1>{zoneName(zoneid) ?? `Zone ${zoneid}`} {live ? <span className="tag own">live</span> : <span className="tag">last known · catseyexi.com</span>}</h1>
      <div className="row">
        {(["unlearned", "near", "all"] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? "active-tab" : ""} onClick={() => { setFilter(f); setPick(undefined); }}>
            {f === "unlearned" ? "Teaches spells I don't have" : f === "near" ? `Near my level (${myLevel})` : "All mobs"}
          </button>
        ))}
        {pick && <button onClick={() => setPick(undefined)}>Show all {shown.length}</button>}
      </div>
      <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
        <div style={{ flex: "0 1 560px" }}><ZoneMap key={zoneid} zoneid={zoneid} points={pts} /></div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <table>
            <tbody>
              {shown.map((m) => (
                <tr key={m.mobname} className="click" onClick={() => setPick(pick === m.mobname ? undefined : m.mobname)}
                  style={pick === m.mobname ? { background: "#232838" } : {}}>
                  <td><span className="link" onClick={(e) => { e.stopPropagation(); go({ name: "mob", mob: m.mobname }); }}>{pretty(m.mobname)}</span>
                    {!!m.aggro && <span className="tag" style={{ color: "var(--bad)" }}>A</span>}{!!m.links && <span className="tag" style={{ color: "var(--warn)" }}>L</span>}</td>
                  <td className="muted">{m.lo === m.hi ? m.lo : `${m.lo}-${m.hi}`}</td>
                  <td>{unlearned(m).map((s) => <span key={s} className="tag cx">★ {s}</span>)}</td>
                </tr>
              ))}
              {!shown.length && <tr><td className="muted">{filter === "unlearned" ? "Nothing here teaches a spell you're missing." : "No mobs match."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
