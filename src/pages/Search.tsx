import { useEffect, useState } from "react";
import { useApp } from "../ctx";
import { q } from "../db";
import { like, pretty } from "../ffxi";
import ItemIcon from "../components/ItemIcon";

type Hit = { kind: "item" | "mob" | "spell"; id: string; name: string; sub: string };

export default function Search({ initial = "" }: { initial?: string }) {
  const { go } = useApp();
  const [text, setText] = useState(initial);
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    if (text.trim().length < 2) return setHits([]);
    let live = true;
    const t = setTimeout(async () => {
      const p = like(text);
      const [items, mobs, spells] = await Promise.all([
        q("SELECT itemid, name FROM item_basic WHERE name LIKE $1 OR sortname LIKE $1 ORDER BY length(name) LIMIT 40", p),
        q(`SELECT sp.mobname, group_concat(DISTINCT z.name) zones, min(sp.minLevel) lo, max(sp.maxLevel) hi
           FROM mob_spawn_points sp LEFT JOIN zones z ON z.zoneid = (sp.mobid >> 12) & 4095
           WHERE sp.mobname LIKE $1 GROUP BY sp.mobname ORDER BY length(sp.mobname) LIMIT 40`, p),
        q("SELECT name, level FROM blu_spells WHERE available=1 AND lower(replace(name,' ','_')) LIKE $1 LIMIT 10", p),
      ]);
      if (!live) return;
      setHits([
        ...spells.map((s: any) => ({ kind: "spell" as const, id: s.name, name: s.name, sub: `Blue Magic lv${s.level}` })),
        ...mobs.map((m: any) => ({ kind: "mob" as const, id: m.mobname, name: pretty(m.mobname), sub: `Lv${m.lo}-${m.hi} · ${m.zones ?? ""}` })),
        ...items.map((i: any) => ({ kind: "item" as const, id: String(i.itemid), name: pretty(i.name), sub: `#${i.itemid}` })),
      ]);
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [text]);

  const open = (h: Hit) =>
    h.kind === "item" ? go({ name: "item", id: Number(h.id) }) : h.kind === "mob" ? go({ name: "mob", mob: h.id }) : go({ name: "blu" });

  return (
    <div>
      <h1>Search</h1>
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Items, mobs, blue spells…" style={{ width: 420 }} />
      <table style={{ marginTop: 12 }}>
        <tbody>
          {hits.map((h) => (
            <tr key={h.kind + h.id} className="click" onClick={() => open(h)}>
              <td style={{ width: 60 }}><span className="tag">{h.kind}</span></td>
              <td>{h.kind === "item" && <ItemIcon id={Number(h.id)} />}{h.name}</td>
              <td className="muted">{h.sub}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Game data comes from LandSandBoat (the server CatseyeXI forks), with CatseyeXI changes layered on top.</p>
    </div>
  );
}
