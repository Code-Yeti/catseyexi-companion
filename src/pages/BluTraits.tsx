import { useEffect, useMemo, useState } from "react";
import { q, getKv, setKv } from "../db";
import { activeTraits, pretty, solveTrait } from "../ffxi";
import { useApp } from "../ctx";
import { resolveSet, type SetSpell } from "./BluSet";

type Tier = { category: number; name: string; tier: number; points: number; effect: string };
type Sp = { name: string; level: number; set_points: number; trait_weight: number; trait_category: number; cx_notes: string | null };

// Retail BLU at 75: 20 spell slots, 55 set points. CatseyeXI adds up to +10 from Assimilation merits and up to +25 from Boruko.
const MAX_SLOTS = 20;

export default function BluTraits({ blu, learned, onSpell }: { blu: number; learned: Set<string>; onSpell: (name: string) => void }) {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [spells, setSpells] = useState<Sp[]>([]);
  const [picks, setPicks] = useState<Record<number, number>>({}); // category -> tier
  const [budget, setBudget] = useState(55);
  const { live } = useApp();
  const [allSpells, setAllSpells] = useState<SetSpell[]>([]);

  useEffect(() => {
    q<Tier>("SELECT category, name, tier, points, effect FROM blu_trait_tiers WHERE jp_only=0 ORDER BY name, tier").then(setTiers);
    q<Sp>("SELECT name, level, set_points, trait_weight, trait_category, cx_notes FROM blu_spells WHERE available=1 AND trait_category IS NOT NULL").then(setSpells);
    q<SetSpell>("SELECT spellid, name, level, set_points, trait_category, trait_weight FROM blu_spells").then(setAllSpells);
    getKv("bluTraitPicks").then((v) => v && setPicks(JSON.parse(v)));
    getKv("bluBudget").then((v) => v && setBudget(Number(v)));
  }, []);

  const save = (p: Record<number, number>) => { setPicks(p); setKv("bluTraitPicks", JSON.stringify(p)); };
  const status = (s: Sp) => learned.has(s.name) ? "learned" : s.level <= blu ? "learnable" : "locked";
  const cost = (s: Sp) => s.set_points + (status(s) === "learned" ? 0 : status(s) === "learnable" ? 0.01 : 100);

  const categories = useMemo(() => {
    const m = new Map<number, Tier[]>();
    for (const t of tiers) m.set(t.category, [...(m.get(t.category) ?? []), t]);
    return [...m.values()];
  }, [tiers]);

  const plans = Object.entries(picks).map(([cat, tierNo]) => {
    const tier = tiers.find((t) => t.category === +cat && t.tier === tierNo);
    const cands = spells.filter((s) => s.trait_category === +cat).sort((a, b) => a.level - b.level);
    return tier && { tier, cands, chosen: solveTrait(cands, tier.points, cost) };
  }).filter(Boolean) as { tier: Tier; cands: Sp[]; chosen: Sp[] | null }[];

  const all = plans.flatMap((p) => p.chosen ?? []);
  const totalPts = all.reduce((a, s) => a + s.set_points, 0);
  const toLearn = all.filter((s) => status(s) !== "learned");

  const current = resolveSet(live, allSpells); // current in-game set (addon)
  const currentTraits = current ? activeTraits(current, tiers) : [];
  const planned = new Set(plans.flatMap((p) => (p.chosen ?? []).map((c) => c.name)));
  const toAdd = current ? [...planned].filter((n) => !current.some((c) => c.name === n)) : [];

  return (
    <div>
      {current && (
        <div className="card">
          <b>Current set (in game)</b> <span className="tag own">live</span>{" "}
          <span className="muted">{current.length}/{MAX_SLOTS} spells · {live!.bluPoints?.spent ?? "?"}/{live!.bluPoints?.max ?? "?"} set points</span>
          <div style={{ marginTop: 6 }}>{current.map((c) => <span key={c.name} className={planned.has(c.name) ? "tag own" : "tag"}>{c.name}</span>)}</div>
          <div style={{ marginTop: 6 }}>Active traits: {currentTraits.length ? currentTraits.map((t) => `${pretty(t.name)} ${t.tier}`).join(", ") : <span className="muted">none</span>}</div>
          {plans.length > 0 && (
            <div className="muted" style={{ marginTop: 4 }}>
              {toAdd.length ? <>To match your plan, set: <b>{toAdd.join(", ")}</b></> : "Your set already covers every planned spell."}
            </div>
          )}
        </div>
      )}
      <p className="muted">Pick the traits you want. For each one, the planner finds the cheapest set of spells (in set points) that reaches the trait,
        preferring spells you've learned or can learn at BLU {blu || "?"}.</p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
        {categories.map((ts) => (
          <label key={ts[0].category} className="job" style={{ textAlign: "left" }}>
            {pretty(ts[0].name)}
            <select value={picks[ts[0].category] ?? ""} style={{ width: "100%", marginTop: 4 }}
              onChange={(e) => { const p = { ...picks }; e.target.value === "" ? delete p[ts[0].category] : (p[ts[0].category] = +e.target.value); save(p); }}>
              <option value="">—</option>
              {ts.map((t) => <option key={t.tier} value={t.tier}>Tier {t.tier} · {t.points} pts · {t.effect}</option>)}
            </select>
          </label>
        ))}
      </div>

      {plans.length > 0 && (
        <div className="card">
          <b>Total: {all.length}/{MAX_SLOTS} spells · {totalPts}/</b>
          <input type="number" value={budget} style={{ width: 60 }} onChange={(e) => { setBudget(+e.target.value); setKv("bluBudget", e.target.value); }} />
          <b> set points</b>
          {(totalPts > budget || all.length > MAX_SLOTS) && <span className="bad"> · over budget</span>}
          <div className="muted">Budget: 55 at Lv75, plus Assimilation merits (+10 on CatseyeXI) and Boruko's bonus (up to +25).</div>
          {toLearn.length > 0 && <div style={{ marginTop: 6 }}>Still to learn: {toLearn.map((s) => `${s.name} (lv${s.level})`).join(", ")}</div>}
        </div>
      )}

      {plans.map(({ tier, cands, chosen }) => {
        const got = (chosen ?? []).reduce((a, s) => a + s.trait_weight, 0);
        return (
          <div key={tier.category} className="card">
            <h2 style={{ marginTop: 0 }}>{pretty(tier.name)} {tier.tier} <span className="muted">· {tier.effect} · needs {tier.points} trait points</span></h2>
            {!chosen ? <div className="bad">Can't be reached with spells available on CatseyeXI ({cands.reduce((a, s) => a + s.trait_weight, 0)} points possible).</div> : (
              <div className="muted">Use {chosen.length} spell{chosen.length > 1 ? "s" : ""} for {got} trait points and {chosen.reduce((a, s) => a + s.set_points, 0)} set points.</div>
            )}
            <table>
              <thead><tr><th></th><th>Spell</th><th>Lv</th><th>Trait pts</th><th>Set pts</th><th>Status</th></tr></thead>
              <tbody>
                {cands.map((s) => {
                  const use = chosen?.includes(s), st = status(s);
                  return (
                    <tr key={s.name} style={use ? { background: "#1f2a22" } : { opacity: 0.6 }}>
                      <td>{use ? "✔" : ""}</td>
                      <td><span className="link" onClick={() => onSpell(s.name)} title="Where to learn it">{s.name}</span>{s.cx_notes && <span className="tag cx" title={s.cx_notes}>CX</span>}</td>
                      <td>{s.level}</td><td>{s.trait_weight}</td><td>{s.set_points}</td>
                      <td className={st === "learned" ? "good" : st === "learnable" ? "warn" : "muted"}>
                        {st === "learned" ? "learned" : st === "learnable" ? "learnable now" : `needs BLU ${s.level}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
