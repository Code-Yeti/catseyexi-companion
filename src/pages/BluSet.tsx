import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { q, getKv } from "../db";
import { pretty, solveTrait } from "../ffxi";
import { useApp } from "../ctx";
import type { Live } from "../live";

export type SetSpell = { spellid: number; name: string; level: number | null; available?: number; set_points: number | null; trait_category: number | null; trait_weight: number | null };
type Tier = { category: number; name: string; tier: number; points: number; effect: string };

// The in-game set (addon client ids) -> spell rows. Names come with the learned list, which catches CatseyeXI spells.
export function resolveSet(live: Live | null, all: SetSpell[]): SetSpell[] | null {
  if (!live?.bluSet) return null;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const names = new Map(live.bluKnown ?? []);
  const byNorm = new Map(all.map((sp) => [norm(sp.name), sp]));
  const byId = new Map(all.filter((sp) => sp.spellid > 0).map((sp) => [sp.spellid, sp])); // LSB ids = client ids
  return live.bluSet.map((id) => byId.get(id) ?? byNorm.get(norm(names.get(id) ?? ""))
    ?? { spellid: id, name: names.get(id) ?? `#${id}`, level: null, set_points: null, trait_category: null, trait_weight: null });
}

const MAX_SLOTS = 20;
const SH = 38, TH = 62; // fixed row heights: rows and curves are positioned by index, so reordering can animate
type Sort = "set" | "trait" | "points" | "name";
const hue = (cat: number) => `hsl(${(cat * 47) % 360} 70% 66%)`;

// Current set: spells (left) wired by curves to the traits they feed (right), plus the cheapest next traits to aim for.
export default function BluSet({ blu, learned, onSpell }: { blu: number; learned: Set<string>; onSpell: (name: string) => void }) {
  const { live } = useApp();
  const [all, setAll] = useState<SetSpell[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [planned, setPlanned] = useState<Record<number, number>>({});
  const [sort, setSort] = useState<Sort>("trait");
  const [hover, setHover] = useState<{ spell?: string; cat?: number }>({});

  useEffect(() => {
    q<SetSpell>("SELECT spellid, name, level, available, set_points, trait_category, trait_weight FROM blu_spells").then(setAll);
    q<Tier>("SELECT category, name, tier, points, effect FROM blu_trait_tiers WHERE jp_only=0 ORDER BY category, tier").then(setTiers);
    getKv("bluTraitPicks").then((v) => v && setPlanned(JSON.parse(v)));
  }, []);

  const set = resolveSet(live, all);
  const byCat = useMemo(() => {
    const m = new Map<number, Tier[]>();
    for (const t of tiers) m.set(t.category, [...(m.get(t.category) ?? []), t]);
    return m;
  }, [tiers]);

  if (!set) return <p className="muted">Connect the game addon (Settings) with BLU as main or sub job to see your current set.</p>;

  const sum = new Map<number, number>();
  for (const s of set) if (s.trait_category != null) sum.set(s.trait_category, (sum.get(s.trait_category) ?? 0) + (s.trait_weight ?? 0));
  const traitName = (cat: number) => pretty(byCat.get(cat)?.[0].name ?? `Trait ${cat}`);

  const spells = [...set].sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name)
    : sort === "points" ? (b.set_points ?? 0) - (a.set_points ?? 0)
    : sort === "trait" ? (a.trait_category == null ? 1 : 0) - (b.trait_category == null ? 1 : 0) || traitName(a.trait_category ?? 0).localeCompare(traitName(b.trait_category ?? 0))
    : 0);
  const spellIdx = new Map(spells.map((s, i) => [s.name, i]));
  // Traits ordered by where their spells sit on the left, which keeps the curves from crossing.
  const traits = [...sum.keys()].sort((a, b) => {
    const avg = (c: number) => { const ix = spells.filter((s) => s.trait_category === c).map((s) => spellIdx.get(s.name)!); return ix.reduce((x, y) => x + y, 0) / ix.length; };
    return avg(a) - avg(b);
  });
  const traitIdx = new Map(traits.map((c, i) => [c, i]));
  const height = Math.max(spells.length * SH, traits.length * TH, 40);
  const lit = (s: SetSpell) => !hover.spell && hover.cat == null ? true : hover.spell === s.name || hover.cat === s.trait_category;

  // Suggested path: for every trait's next tier, the cheapest spells to add (learned first, then learnable now).
  const inSet = new Set(set.map((s) => s.name));
  const freePts = (live!.bluPoints?.max ?? 55) - (live!.bluPoints?.spent ?? 0), freeSlots = MAX_SLOTS - set.length;
  const status = (s: SetSpell) => learned.has(s.name) ? "learned" : (s.level ?? 99) <= blu ? "learnable" : "locked";
  const suggestions = [...byCat.entries()].flatMap(([cat, ts]) => {
    const have = sum.get(cat) ?? 0, next = ts.find((t) => t.points > have);
    if (!next) return [];
    const cands = all.filter((s) => s.available && s.trait_category === cat && !inSet.has(s.name) && status(s) !== "locked") as (SetSpell & { trait_weight: number })[];
    const add = solveTrait(cands, next.points - have, (s) => (s.set_points ?? 0) + (status(s) === "learned" ? 0 : 0.01));
    if (!add) return [];
    const pts = add.reduce((a, s) => a + (s.set_points ?? 0), 0);
    return [{ cat, next, have, add, pts, fits: pts <= freePts && add.length <= freeSlots, plan: planned[cat] != null && planned[cat] >= next.tier }];
  }).sort((a, b) => +b.plan - +a.plan || +b.fits - +a.fits || a.pts - b.pts).slice(0, 8);

  return (
    <div>
      <div className="row">
        <span className="muted">{set.length}/{MAX_SLOTS} spells · {live!.bluPoints?.spent ?? "?"}/{live!.bluPoints?.max ?? "?"} set points</span>
        <span style={{ marginLeft: "auto" }} className="muted">Order by</span>
        {(["set", "trait", "points", "name"] as Sort[]).map((s) => (
          <button key={s} className={sort === s ? "active-tab" : ""} onClick={() => setSort(s)}>
            {s === "set" ? "In-game order" : s === "trait" ? "Trait" : s === "points" ? "Set points" : "Name"}
          </button>
        ))}
      </div>

      <div className="set-graph" style={{ height }} onMouseLeave={() => setHover({})}>
        <div className="set-col">
          {spells.map((s, i) => (
            <div key={s.name} className="set-row" style={{ top: i * SH, height: SH - 6, opacity: lit(s) ? 1 : 0.35 }}
              onMouseEnter={() => setHover({ spell: s.name })}>
              <span className="link" onClick={() => onSpell(s.name)}>{s.name}</span>
              <span className="muted"> {s.set_points ?? "?"} pts</span>
              {s.trait_category != null
                ? <span className="contrib" style={{ background: hue(s.trait_category) }}>+{s.trait_weight}</span>
                : <span className="contrib none">no trait</span>}
            </div>
          ))}
        </div>
        <svg className="set-lines" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }}>
          {spells.filter((s) => s.trait_category != null && traitIdx.has(s.trait_category)).map((s) => {
            const y1 = spellIdx.get(s.name)! * SH + (SH - 6) / 2, y2 = traitIdx.get(s.trait_category!)! * TH + (TH - 8) / 2;
            return <path key={s.name} style={{ d: `path("M0 ${y1} C50 ${y1} 50 ${y2} 100 ${y2}")`, opacity: lit(s) ? 0.9 : 0.12 } as CSSProperties}
              stroke={hue(s.trait_category!)} strokeWidth={1 + (s.trait_weight ?? 1)} />;
          })}
        </svg>
        <div className="set-col">
          {traits.map((c, i) => {
            const ts = byCat.get(c) ?? [], have = sum.get(c)!;
            const active = [...ts].reverse().find((t) => t.points <= have), next = ts.find((t) => t.points > have);
            const goal = next?.points ?? active?.points ?? have;
            return (
              <div key={c} className="set-row trait" style={{ top: i * TH, height: TH - 8, borderColor: hue(c), opacity: hover.cat == null && !hover.spell || hover.cat === c || set.some((s) => s.name === hover.spell && s.trait_category === c) ? 1 : 0.35 }}
                onMouseEnter={() => setHover({ cat: c })}>
                <div><b style={{ color: hue(c) }}>{traitName(c)}</b> {active ? <span className="tag own">Tier {active.tier} · {active.effect}</span> : <span className="tag">inactive</span>}</div>
                <div className="trait-bar"><div style={{ width: `${Math.min(100, (have / goal) * 100)}%`, background: hue(c) }} /></div>
                <div className="muted">{have}/{goal} trait points{next ? ` · ${next.points - have} more for tier ${next.tier}` : " · max tier"}</div>
              </div>
            );
          })}
        </div>
      </div>

      <h2>Suggested next traits</h2>
      <p className="muted">The cheapest way to reach each trait's next tier with spells you've learned or can learn now. Your Trait planner picks come first,
        then what fits your {freePts} free set points and {freeSlots} free slots.</p>
      <table>
        <thead><tr><th>Trait</th><th>Now</th><th>Add</th><th>Set pts</th><th></th></tr></thead>
        <tbody>
          {suggestions.map((g) => (
            <tr key={g.cat}>
              <td><b style={{ color: hue(g.cat) }}>{traitName(g.cat)} {g.next.tier}</b> <span className="muted">{g.next.effect}</span></td>
              <td className="muted">{g.have}/{g.next.points}</td>
              <td>{g.add.map((s) => (
                <span key={s.name} className={status(s) === "learned" ? "tag" : "tag cx"} title={status(s) === "learned" ? "Learned" : "Learn it first"}>
                  <span className="link" onClick={() => onSpell(s.name)}>{s.name}</span> +{s.trait_weight}{status(s) !== "learned" && " ★"}
                </span>
              ))}</td>
              <td>{g.pts}</td>
              <td>{g.plan && <span className="tag own">in your plan</span>}{g.fits ? <span className="good">fits now</span> : <span className="muted">swap something out</span>}</td>
            </tr>
          ))}
          {!suggestions.length && <tr><td className="muted">Nothing reachable with the spells you can learn at BLU {blu}.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
