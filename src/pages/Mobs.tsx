import { useEffect, useMemo, useState } from "react";
import { useApp } from "../ctx";
import { q } from "../db";

type Row = { mobname: string; name: string; zoneid: number; zone: string; lo: number; hi: number; n: number; respawn: number;
  aggro: number; links: number; truesight: number; family: string | null; blu: string | null;
  cx_lo: number | null; cx_hi: number | null; era: number };
type Key = "name" | "zone" | "lo" | "n" | "respawn" | "family";

const COLS: [Key, string][] = [["name", "Mob"], ["zone", "Zone"], ["lo", "Level"], ["family", "Family"], ["n", "Spawns"], ["respawn", "Respawn"]];
const LIMIT = 500;

export default function Mobs() {
  const { go, char } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [f, setF] = useState({ text: "", zone: "", min: "", max: "", aggro: "any", bluOnly: false, era: true });
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "lo", dir: 1 });

  // lo/hi become CatseyeXI's levels where the build fetched them (re-levelled zones like Escha); lsb_* keeps LSB's.
  useEffect(() => {
    q<Row>("SELECT *, lo AS lsb_lo, hi AS lsb_hi, coalesce(cx_lo, lo) AS lo, coalesce(cx_hi, hi) AS hi FROM mob_index").then(setRows);
  }, []);

  // era (from the build): on CatseyeXI and within reach of a 75 — no lv<=1 placeholders, no retail-only Adoulin zones.
  const inEra = (r: Row) => !!r.era;
  const zones = useMemo(() => [...new Set(rows.filter((r) => !f.era || inEra(r)).map((r) => r.zone))].filter(Boolean).sort(), [rows, f.era]);

  const shown = useMemo(() => {
    const t = f.text.toLowerCase(), min = Number(f.min) || 0, max = Number(f.max) || 999;
    const out = rows.filter((r) =>
      (!f.era || inEra(r)) && (!f.zone || r.zone === f.zone) && r.hi >= min && r.lo <= max &&
      (f.aggro === "any" || (f.aggro === "aggro") === !!r.aggro) && (!f.bluOnly || r.blu) &&
      (!t || r.name.toLowerCase().includes(t) || r.family?.toLowerCase().includes(t) || r.blu?.toLowerCase().includes(t)));
    const k = sort.key;
    return out.sort((a, b) => {
      const c = typeof a[k] === "number" ? (a[k] as number) - (b[k] as number) : String(a[k] ?? "").localeCompare(String(b[k] ?? ""));
      return sort.dir * (c || a.hi - b.hi || a.name.localeCompare(b.name));
    });
  }, [rows, f, sort]);

  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });
  const myLvl = char ? Number(char.mlvl) : undefined;

  return (
    <div>
      <h1>Mobs</h1>
      <div className="row">
        <input placeholder="Name, family or blue spell" value={f.text} onChange={(e) => set("text", e.target.value)} style={{ width: 220 }} />
        <select value={f.zone} onChange={(e) => set("zone", e.target.value)}>
          <option value="">All zones</option>
          {zones.map((z) => <option key={z}>{z}</option>)}
        </select>
        <span>Lv <input value={f.min} onChange={(e) => set("min", e.target.value)} style={{ width: 48 }} placeholder="min" /> –{" "}
          <input value={f.max} onChange={(e) => set("max", e.target.value)} style={{ width: 48 }} placeholder="max" /></span>
        {myLvl && <button onClick={() => setF({ ...f, min: String(Math.max(1, myLvl - 5)), max: String(myLvl + 3) })}>Near my level ({myLvl})</button>}
        <select value={f.aggro} onChange={(e) => set("aggro", e.target.value)}>
          <option value="any">Aggro: any</option><option value="aggro">Aggressive</option><option value="passive">Passive</option>
        </select>
        <label><input type="checkbox" checked={f.bluOnly} onChange={(e) => set("bluOnly", e.target.checked)} /> Teaches blue magic</label>
        <label title="Hides placeholders, mobs above 85, and retail zones CatseyeXI doesn't use"><input type="checkbox" checked={f.era} onChange={(e) => set("era", e.target.checked)} /> CatseyeXI content only</label>
      </div>
      <div className="muted">{shown.length} mobs{shown.length > LIMIT ? `, showing the first ${LIMIT}. Narrow the filters to see more` : ""} · levels from LSB unless tagged CX</div>
      <table>
        <thead>
          <tr>
            {COLS.map(([k, label]) => (
              <th key={k} className="link" onClick={() => setSort({ key: k, dir: sort.key === k ? (-sort.dir as 1 | -1) : 1 })}>
                {label}{sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
            <th>Flags</th><th>Blue magic</th>
          </tr>
        </thead>
        <tbody>
          {shown.slice(0, LIMIT).map((r) => (
            <tr key={r.mobname + r.zoneid} className="click" onClick={() => go({ name: "mob", mob: r.mobname })}>
              <td>{r.name}</td>
              <td className="muted">{r.zone}</td>
              <td>{r.lo === r.hi ? r.lo : `${r.lo}-${r.hi}`}{r.cx_lo != null && <span className="tag cx" title="CatseyeXI level (re-levelled from retail)">CX</span>}</td>
              <td className="muted">{r.family}</td>
              <td className="muted">{r.n}</td>
              <td className="muted">{r.respawn ? (r.respawn >= 3600 ? `${Math.round(r.respawn / 3600)}h` : `${Math.round(r.respawn / 60)}m`) : "-"}</td>
              <td>
                {!!r.aggro && <span className="tag" style={{ color: "var(--bad)" }} title="Aggressive">A</span>}
                {!!r.links && <span className="tag" style={{ color: "var(--warn)" }} title="Links">L</span>}
                {!!r.truesight && <span className="tag" title="True sight/sound: sees through Sneak/Invisible">TS</span>}
              </td>
              <td style={{ color: "var(--cx)", fontSize: 12 }}>{r.blu}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
