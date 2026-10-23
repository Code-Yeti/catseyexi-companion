import { useEffect, useState } from "react";
import { useApp } from "../ctx";
import { searchMobs, type CxMob } from "../catseye";
import { q } from "../db";
import { DROP_TYPE, pretty, wikiUrl } from "../ffxi";
import ZoneMap, { type Pt } from "../components/ZoneMap";

type Spawn = { zoneid: number; zone: string; x: number; z: number; minLevel: number; maxLevel: number; dropid: number; skill_list_id: number; respawntime: number };

export default function Mob({ name }: { name: string }) {
  const { go } = useApp();
  const [spawns, setSpawns] = useState<Spawn[]>([]);
  const [zoneid, setZoneid] = useState<number>();
  const [drops, setDrops] = useState<any[]>([]);
  const [spells, setSpells] = useState<any[]>([]);
  const [cxMob, setCxMob] = useState<CxMob | null>();
  const [cxLv, setCxLv] = useState<Map<number, { cx_lo: number; cx_hi: number }>>(new Map());

  useEffect(() => {
    (async () => {
      const s = await q<Spawn>(`SELECT s.zoneid, z.name zone, s.x, s.z, s.minLevel, s.maxLevel, s.dropid, s.skill_list_id, s.respawntime
                                FROM spawns s LEFT JOIN zones z USING (zoneid) WHERE s.mobname=$1`, name);
      setSpawns(s);
      setCxLv(new Map((await q("SELECT zoneid, cx_lo, cx_hi FROM mob_index WHERE mobname=$1 AND cx_lo IS NOT NULL", name)).map((r: any) => [r.zoneid, r])));
      setZoneid(s[0]?.zoneid);
      const dropIds = [...new Set(s.map((x) => x.dropid))].filter(Boolean);
      const lists = [...new Set(s.map((x) => x.skill_list_id))].filter(Boolean);
      if (dropIds.length)
        setDrops(await q(`SELECT DISTINCT d.itemId, i.name, d.dropType, d.itemRate FROM mob_droplist d JOIN item_basic i ON i.itemid=d.itemId
                          WHERE d.dropId IN (${dropIds.join(",")}) ORDER BY d.dropType, d.itemRate DESC`));
      if (lists.length)
        setSpells(await q(`SELECT DISTINCT b.name, b.level, b.cx_notes FROM blu_spells b JOIN blu_spell_skills bs USING (spellid)
                           JOIN mob_skill_lists sl ON sl.mob_skill_id=bs.mob_skill_id WHERE b.available=1 AND sl.skill_list_id IN (${lists.join(",")})
                           ORDER BY b.level`));
    })();
    // Confirm against the live CatseyeXI database (cached after first look).
    searchMobs(name).then((r) => setCxMob(r.data.mobs.find((m) => m.mobname.toLowerCase() === name.toLowerCase()) ?? null)).catch(() => setCxMob(undefined));
  }, [name]);

  const zones = [...new Map(spawns.map((s) => [s.zoneid, s])).values()];
  const here = spawns.filter((s) => s.zoneid === zoneid);
  const pts: Pt[] = here.map((s) => ({ x: s.x, z: s.z, label: pretty(name) }));
  const lv = (r: Spawn[]) => `${Math.min(...r.map((s) => s.minLevel))}-${Math.max(...r.map((s) => s.maxLevel))}`;

  return (
    <div>
      <h1>{pretty(name)} <a className="tag" href={wikiUrl(pretty(name))} target="_blank">bg-wiki</a></h1>
      {cxMob === null && <div className="cxnote">Not found in CatseyeXI's mob search. It may be renamed or absent on this server.</div>}
      {cxMob && <div className="muted">On CatseyeXI <span className="tag cx">CX</span> level {cxMob.minLevel ?? "?"}-{cxMob.maxLevel ?? "?"}</div>}

      <h2>Where</h2>
      <table>
        <thead><tr><th>Zone</th><th>Spawns</th><th>Level</th><th>Respawn</th></tr></thead>
        <tbody>
          {zones.map((z) => {
            const r = spawns.filter((s) => s.zoneid === z.zoneid);
            return (
              <tr key={z.zoneid} className="click" onClick={() => setZoneid(z.zoneid)} style={z.zoneid === zoneid ? { background: "#232838" } : {}}>
                <td>{z.zone}</td><td>{r.length}</td><td>{cxLv.has(z.zoneid) ? <>{cxLv.get(z.zoneid)!.cx_lo}-{cxLv.get(z.zoneid)!.cx_hi} <span className="tag cx">CX</span></> : <>{lv(r)} <span className="tag lsb">LSB</span></>}</td><td>{z.respawntime ? `${Math.round(z.respawntime / 60)} min` : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {zoneid !== undefined && <ZoneMap zoneid={zoneid} points={pts} />}

      {spells.length > 0 && (
        <>
          <h2>Blue Magic taught</h2>
          {spells.map((s) => (
            <div key={s.name}><span className="link" onClick={() => go({ name: "blu" })}>{s.name}</span> <span className="muted">lv{s.level}</span>
              {s.cx_notes && <span className="tag cx">CX: {s.cx_notes}</span>}</div>
          ))}
        </>
      )}

      <h2>Drops <span className="tag lsb">LSB</span></h2>
      <div className="cxnote">CatseyeXI drop tables can differ from LSB. NMs use their rarer drop versions. Check <a href={wikiUrl("CatsEyeXI_Content/Drops")} target="_blank">CatsEyeXI drops</a>.</div>
      <table>
        <tbody>
          {drops.map((d, i) => (
            <tr key={i} className="click" onClick={() => go({ name: "item", id: d.itemId })}>
              <td>{pretty(d.name)}</td><td className="muted">{DROP_TYPE[d.dropType] ?? d.dropType}</td>
              <td className="muted">{d.itemRate ? `${d.itemRate / 10}%` : ""}</td>
            </tr>
          ))}
          {!drops.length && <tr><td className="muted">No drops listed</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
