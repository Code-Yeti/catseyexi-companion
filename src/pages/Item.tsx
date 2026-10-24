import { useEffect, useState } from "react";
import { useApp } from "../ctx";
import { getItem, type CxItem } from "../catseye";
import { q } from "../db";
import { DROP_TYPE, JOBS, pretty, shownMod, wikiUrl } from "../ffxi";
import ItemIcon from "../components/ItemIcon";

export default function Item({ id }: { id: number }) {
  const { go, owned, where } = useApp();
  const [name, setName] = useState<string>();
  const [cxItem, setCxItem] = useState<CxItem>();
  const [cxErr, setCxErr] = useState<string>();
  const [mods, setMods] = useState<{ name: string; value: number }[]>([]);
  const [droppers, setDroppers] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setName((await q("SELECT name FROM item_basic WHERE itemid=$1", id))[0]?.name);
      setDroppers(await q(`SELECT s.mobname, z.name zone, d.dropType, d.itemRate, min(s.minLevel) lo, max(s.maxLevel) hi
                           FROM mob_droplist d JOIN spawns s ON s.dropid=d.dropId LEFT JOIN zones z ON z.zoneid=s.zoneid
                           WHERE d.itemId=$1 GROUP BY s.mobname, s.zoneid, d.dropType ORDER BY d.itemRate DESC LIMIT 200`, id));
      // Stats: CatseyeXI's own item data wins; fall back to LSB if offline.
      const modNames = Object.fromEntries((await q("SELECT id, name FROM mod_names")).map((m: any) => [m.id, m.name]));
      try {
        const r = await getItem(id);
        setCxItem(r.data);
        setMods(r.data.mods.map((m) => ({ name: modNames[m.modId ?? m.modid!] ?? `mod ${m.modId ?? m.modid}`, value: m.value })));
      } catch (e) {
        setCxErr(String(e));
        setMods((await q("SELECT modId, value FROM item_mods WHERE itemId=$1", id)).map((m: any) => ({ name: modNames[m.modId] ?? `mod ${m.modId}`, value: m.value })));
      }
    })();
  }, [id]);

  const title = cxItem?.item.name ?? (name ? pretty(name) : `#${id}`);
  const jobs = cxItem?.item.jobs ? JOBS.filter((_, i) => cxItem.item.jobs & (1 << i)).map((j) => j.toUpperCase()) : [];

  return (
    <div>
      <h1><ItemIcon id={id} size={32} />{title} {owned.has(id) && <span className="tag own">owned{where.get(id) ? `: ${where.get(id)!.join(", ")}` : ""}</span>} <a className="tag" href={wikiUrl(title)} target="_blank">bg-wiki</a></h1>
      <div className="card">
        {cxItem ? <span className="tag cx">CatseyeXI data</span> : <span className="tag lsb">LSB data{cxErr ? " (CatseyeXI offline)" : ""}</span>}
        {cxItem?.item.level ? <div>Lv{cxItem.item.level} {jobs.length === 22 ? "All Jobs" : jobs.join(" / ")}</div> : null}
        {cxItem?.weapon && <div>DMG {cxItem.weapon.dmg} · Delay {cxItem.weapon.delay}</div>}
        {mods.filter((m) => shownMod(m.name)).map((m, i) => <div key={i}>{m.name} {m.value > 0 ? "+" : ""}{m.value}</div>)}
      </div>

      <h2>Dropped by <span className="tag lsb">LSB</span></h2>
      <table>
        <tbody>
          {droppers.map((d, i) => (
            <tr key={i} className="click" onClick={() => go({ name: "mob", mob: d.mobname })}>
              <td>{pretty(d.mobname)}</td><td className="muted">{d.zone}</td><td className="muted">Lv{d.lo}-{d.hi}</td>
              <td className="muted">{DROP_TYPE[d.dropType] ?? d.dropType} {d.itemRate ? `${d.itemRate / 10}%` : ""}</td>
            </tr>
          ))}
          {!droppers.length && <tr><td className="muted">No mob drops in LSB data. It may be crafted, a quest reward, or CatseyeXI custom.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
