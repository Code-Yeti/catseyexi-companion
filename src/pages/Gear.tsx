import { useEffect, useState } from "react";
import { useApp } from "../ctx";
import { cx, getItem } from "../catseye";
import { q, uq, uexec } from "../db";
import { JOBS, LEVEL_CAP, SLOTS, jobMask, jobName, like, pretty, shownMod } from "../ffxi";

type Set_ = { id?: number; job: string; name: string; slots: Record<string, number> };
type Opt = { itemId: number; name: string; level: number; cx: boolean };

export default function Gear() {
  const { char, owned, go, where } = useApp();
  const [job, setJob] = useState(char ? JOBS[Number(char.mjob) - 1] : "war");
  const [sets, setSets] = useState<Set_[]>([]);
  const [cur, setCur] = useState<Set_>({ job, name: "New set", slots: {} });
  const [names, setNames] = useState<Record<number, string>>({});
  const [totals, setTotals] = useState<[string, number][]>([]);

  const loadSets = async (j: string) => {
    const r = (await uq("SELECT * FROM gearsets WHERE job=$1 ORDER BY name", j)).map((s: any) => ({ ...s, slots: JSON.parse(s.slots) }));
    setSets(r);
    setCur(r[0] ?? { job: j, name: "New set", slots: {} });
  };
  useEffect(() => { loadSets(job); }, [job]);

  // Names + summed stats for the current set (CatseyeXI item data, cached).
  useEffect(() => {
    (async () => {
      const ids = Object.values(cur.slots).filter(Boolean);
      const modNames = Object.fromEntries((await q("SELECT id, name FROM mod_names")).map((m: any) => [m.id, m.name]));
      const sum = new Map<string, number>();
      const nm: Record<number, string> = {};
      for (const id of ids) {
        try {
          const it = (await getItem(id)).data;
          nm[id] = it.item.name;
          for (const m of it.mods) { const k = modNames[m.modId ?? m.modid!] ?? `mod ${m.modId ?? m.modid}`; sum.set(k, (sum.get(k) ?? 0) + m.value); }
        } catch {
          nm[id] = pretty((await q("SELECT name FROM item_basic WHERE itemid=$1", id))[0]?.name ?? `#${id}`);
          for (const m of await q("SELECT modId, value FROM item_mods WHERE itemId=$1", id)) {
            const k = modNames[m.modId] ?? `mod ${m.modId}`; sum.set(k, (sum.get(k) ?? 0) + m.value);
          }
        }
      }
      setNames(nm);
      setTotals([...sum].filter(([k, v]) => v !== 0 && shownMod(k)));
    })();
  }, [cur]);

  const save = async () => {
    const name = prompt("Set name:", cur.name);
    if (!name) return;
    if (cur.id) await uexec("UPDATE gearsets SET name=$1, slots=$2 WHERE id=$3", name, JSON.stringify(cur.slots), cur.id);
    else await uexec("INSERT INTO gearsets (job, name, slots) VALUES ($1,$2,$3)", job, name, JSON.stringify(cur.slots));
    await loadSets(job);
  };
  const del = async () => { if (cur.id && confirm(`Delete ${cur.name}?`)) { await uexec("DELETE FROM gearsets WHERE id=$1", cur.id); loadSets(job); } };
  const setSlot = (k: string, id?: number) => setCur((c) => { const slots = { ...c.slots }; id ? (slots[k] = id) : delete slots[k]; return { ...c, slots }; });

  const need = Object.values(cur.slots).filter((id) => !owned.has(id));
  const jobLv = char?.jobs[job] ?? LEVEL_CAP;

  return (
    <div>
      <h1>Gear planner</h1>
      <div className="row">
        <select value={job} onChange={(e) => setJob(e.target.value)}>
          {JOBS.map((j) => <option key={j} value={j}>{j.toUpperCase()} {char ? `(${char.jobs[j] ?? 0})` : ""}</option>)}
        </select>
        <select value={cur.id ?? ""} onChange={(e) => setCur(sets.find((s) => s.id === Number(e.target.value)) ?? { job, name: "New set", slots: {} })}>
          {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="">+ New set</option>
        </select>
        <button onClick={save}>Save</button>
        {cur.id && <button onClick={del}>Delete</button>}
        {char && jobName(char.mjob).toLowerCase() === job && (
          <button onClick={() => setCur({ ...cur, slots: Object.fromEntries(Object.entries(char.equipment).filter(([, v]) => v)) })}>Copy what I'm wearing</button>
        )}
      </div>

      <div className="slots">
        {SLOTS.map(([k, label, mask]) => (
          <Slot key={k} label={label} mask={mask} job={job} maxLevel={Math.max(jobLv, 1)} itemId={cur.slots[k]}
            name={cur.slots[k] ? names[cur.slots[k]] : undefined} owned={owned.has(cur.slots[k])} bag={where.get(cur.slots[k])?.join(", ")} onPick={(id) => setSlot(k, id)} />
        ))}
      </div>

      <div className="row" style={{ alignItems: "flex-start", gap: 30 }}>
        <div>
          <h2>Totals</h2>
          {totals.map(([k, v]) => <div key={k}>{k} {v > 0 ? "+" : ""}{v}</div>)}
          {!totals.length && <div className="muted">Pick some gear</div>}
        </div>
        <div>
          <h2>Still need ({need.length})</h2>
          {need.map((id) => <div key={id}><span className="link" onClick={() => go({ name: "item", id })}>{names[id] ?? `#${id}`}</span></div>)}
          {!char && <div className="muted">Load your character to see what you own.</div>}
        </div>
      </div>
    </div>
  );
}

function Slot({ label, mask, job, maxLevel, itemId, name, owned, bag, onPick }: {
  label: string; mask: number; job: string; maxLevel: number; itemId?: number; name?: string; owned: boolean; bag?: string; onPick: (id?: number) => void;
}) {
  const [text, setText] = useState("");
  const [opts, setOpts] = useState<Opt[]>();

  useEffect(() => {
    if (opts === undefined) return;
    const t = setTimeout(async () => {
      const jm = jobMask(job);
      let r: Opt[] = [];
      if (text.trim().length >= 3) {
        // CatseyeXI's own equipment DB first (includes custom gear), LSB as offline fallback.
        try {
          const res = await cx<{ items: any[] }>(`/equipment/search?q=${encodeURIComponent(text.trim())}`);
          r = res.data.items.filter((i) => i.slot & mask && i.jobs & jm && i.level <= LEVEL_CAP).map((i) => ({ itemId: i.itemId, name: i.name, level: i.level, cx: true }));
        } catch { /* offline */ }
      }
      if (!r.length)
        r = (await q(`SELECT e.itemId, i.name, e.level FROM item_equipment e JOIN item_basic i ON i.itemid=e.itemId
                      WHERE (e.slot & $1) != 0 AND (e.jobs & $2) != 0 AND e.level <= $3 AND i.name LIKE $4
                      ORDER BY e.level DESC LIMIT 40`, mask, jm, LEVEL_CAP, like(text)))
          .map((i: any) => ({ itemId: i.itemId, name: pretty(i.name), level: i.level, cx: false }));
      setOpts(r.sort((a, b) => b.level - a.level));
    }, 250);
    return () => clearTimeout(t);
  }, [text, opts === undefined]);

  return (
    <div className="slot">
      <div className="lbl">{label} {itemId ? <span className={owned ? "tag own" : "tag"} title={bag}>{owned ? (bag ?? "owned") : "need"}</span> : null}</div>
      <input value={opts ? text : name ?? ""} placeholder="—" style={{ width: "100%", border: 0, padding: "2px 0", background: "transparent" }}
        onFocus={() => { setText(""); setOpts([]); }} onBlur={() => setTimeout(() => setOpts(undefined), 200)}
        onChange={(e) => setText(e.target.value)} />
      {opts && (
        <div className="picker">
          {itemId && <div className="muted" onMouseDown={() => onPick(undefined)}>(clear slot)</div>}
          {opts.map((o) => (
            <div key={o.itemId} onMouseDown={() => onPick(o.itemId)} className={o.level > maxLevel ? "muted" : ""}>
              {o.name} <span className="muted">Lv{o.level}</span> {o.cx && <span className="tag cx">CX</span>}
            </div>
          ))}
          {!opts.length && <div className="muted">Type to search</div>}
        </div>
      )}
    </div>
  );
}
