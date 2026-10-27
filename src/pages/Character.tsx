import { useEffect, useState } from "react";
import { useApp } from "../ctx";
import { parseCharId } from "../catseye";
import { q } from "../db";
import { JOBS, LEVEL_CAP, NATIONS, SLOTS, accountLabel, jobName, pretty } from "../ffxi";
import ItemIcon from "../components/ItemIcon";
import Portrait from "../components/Portrait";

export default function CharacterPage() {
  const { char, charId, owned, fetchedAt, stale, loadChar, go } = useApp();
  const [input, setInput] = useState(charId ?? "");
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<number, string>>({});
  const [zone, setZone] = useState<string>();

  useEffect(() => {
    if (!char) return;
    const ids = Object.values(char.equipment).filter(Boolean);
    if (ids.length)
      q<{ itemid: number; name: string }>(`SELECT itemid, name FROM item_basic WHERE itemid IN (${ids.map(Number).join(",")})`)
        .then((r) => setNames(Object.fromEntries(r.map((i) => [i.itemid, pretty(i.name)]))));
    q<{ name: string }>("SELECT name FROM zones WHERE zoneid=$1", char.pos_zone).then((r) => setZone(r[0]?.name));
  }, [char]);

  const submit = async (refresh: boolean) => {
    const id = parseCharId(input) ?? charId;
    if (!id) return;
    setBusy(true);
    await loadChar(id, refresh);
    setBusy(false);
  };

  return (
    <div>
      <h1>Character</h1>
      <div className="row">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="CatseyeXI char id or URL, e.g. https://catseyexi.com/char/25929"
          style={{ width: 420 }} onKeyDown={(e) => e.key === "Enter" && submit(true)} />
        <button onClick={() => submit(true)} disabled={busy}>{busy ? "Loading…" : char ? "Refresh" : "Load"}</button>
        {fetchedAt && <span className="muted">Updated {new Date(fetchedAt).toLocaleTimeString()} · refreshes every 3 min</span>}
        {stale && <span className="warn">Offline, showing cached data ({stale})</span>}
      </div>

      {!char ? (
        <p className="muted">Enter your CatseyeXI character id to pull jobs, gear and owned items from catseyexi.com.</p>
      ) : (
        <>
          <div className="card row" style={{ alignItems: "center" }}>
            <Portrait race={char.race} job={char.mjob} size={150} />
            <div>
            <h1 style={{ margin: 0 }}>{char.charname} <span className={char.isOnline ? "tag own" : "tag"}>{char.isOnline ? "online" : "offline"}</span></h1>
            <div className="muted">
              {jobName(char.mjob)}{char.mlvl}/{jobName(char.sjob)}{char.slvl} · {NATIONS[char.nation]} (rank{" "}
              {[char.rank_sandoria, char.rank_bastok, char.rank_windurst][char.nation]}) · {accountLabel(char.accountType)} ·
              Last zone: {zone ?? char.pos_zone}
            </div>
            {char.accountType === 1 && <div className="cxnote">Crystal Warrior: no Auction House, and some content is level-capped. See <a href="https://www.bg-wiki.com/ffxi/CatsEyeXI_Content/Crystal_Warrior" target="_blank">CW rules</a>.</div>}
            </div>
          </div>

          <h2>Jobs</h2>
          <div className="grid">
            {JOBS.map((j) => {
              const lv = char.jobs[j] ?? 0;
              return (
                <div key={j} className={`job ${lv >= LEVEL_CAP ? "cap" : ""} ${lv === 0 ? "zero" : ""}`}>
                  {j.toUpperCase()}<b>{lv}</b>
                </div>
              );
            })}
          </div>

          <h2>Equipped</h2>
          <table>
            <tbody>
              {SLOTS.filter(([k]) => char.equipment[k]).map(([k, label]) => (
                <tr key={k} className="click" onClick={() => go({ name: "item", id: char.equipment[k] })}>
                  <td className="muted" style={{ width: 80 }}>{label}</td>
                  <td><ItemIcon id={char.equipment[k]} />{names[char.equipment[k]] ?? `#${char.equipment[k]}`}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Crafts</h2>
          <div className="row">
            {Object.entries(char.crafts).map(([k, v]) => <span key={k} className="job">{pretty(k)} <b>{v}</b></span>)}
            {!Object.keys(char.crafts).length && <span className="muted">None</span>}
          </div>

          {(char.relics.length > 0 || char.mythics.length > 0) && (
            <><h2>Relic / Mythic</h2><div>{[...char.relics, ...char.mythics].join(", ")}</div></>
          )}
          <p className="muted">{owned.size} distinct items owned (from catseyexi.com inventory). Merits: {char.exp.merits ?? 0}.</p>
        </>
      )}
    </div>
  );
}
