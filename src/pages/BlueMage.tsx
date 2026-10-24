import { useEffect, useMemo, useState } from "react";
import { useApp } from "../ctx";
import { q, uq, uexec } from "../db";
import { pretty, wikiUrl } from "../ffxi";
import ZoneMap from "../components/ZoneMap";
import BluTraits from "./BluTraits";
import BluSet from "./BluSet";

type Spell = { spellid: number; name: string; level: number; lsb_level: number | null; set_points: number | null; cx_notes: string | null; content_tag: string };
type Source = { mobname: string; zoneid: number; zone: string; n: number; lo: number; hi: number; cx?: boolean; era?: number };

export default function BlueMage() {
  const { char, go, live, liveLearned, zoneName } = useApp();
  // Freshest BLU level: the game (addon) when BLU is main/sub, else the last catseyexi.com refresh.
  const blu = live?.mainJob === 16 ? live.mainLevel : live?.subJob === 16 ? Math.max(live.subLevel, char?.jobs.blu ?? 0) : char?.jobs.blu ?? 0;
  const [history, setHistory] = useState<Map<string, { zoneid: number; mob: string | null; time: number }>>(new Map());
  const [spells, setSpells] = useState<Spell[]>([]);
  const [learned, setLearned] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState({ text: "", hideLearned: true, onlyLearnable: false });
  const [open, setOpen] = useState<string>();
  const [adjust, setAdjust] = useState<string>();
  const [tab, setTab] = useState<"spells" | "set" | "traits">("spells");
  const showSpell = (name: string) => { setTab("spells"); setFilter({ text: name, hideLearned: false, onlyLearnable: false }); setOpen(name); };

  useEffect(() => {
    q<Spell>("SELECT * FROM blu_spells WHERE available=1 ORDER BY level, name").then(setSpells);
    q("SELECT wikitext FROM cx_text WHERE key='blu_adjustments'").then((r) => setAdjust(r[0]?.wikitext));
  }, []);
  // App mirrors the game's learned list into blu_learned, so reloading it whenever that changes is enough.
  useEffect(() => {
    uq<{ name: string }>("SELECT name FROM blu_learned").then((r) => setLearned(new Set(r.map((x) => x.name))));
    uq<any>("SELECT * FROM blu_history").then((r) => setHistory(new Map(r.map((h) => [h.name, h]))));
  }, [liveLearned]);
  const fromGame = (s: Spell) => !!liveLearned && s.lsb_level != null; // the client knows this spell: game decides

  const toggle = async (name: string) => {
    const has = learned.has(name);
    await uexec(has ? "DELETE FROM blu_learned WHERE name=$1" : "INSERT OR IGNORE INTO blu_learned VALUES ($1)", name);
    const next = new Set(learned);
    has ? next.delete(name) : next.add(name);
    setLearned(next);
  };

  const shown = useMemo(() => spells.filter((s) =>
    (!filter.hideLearned || !learned.has(s.name)) &&
    (!filter.onlyLearnable || s.level <= blu) &&
    s.name.toLowerCase().includes(filter.text.toLowerCase())), [spells, learned, filter, blu]);

  return (
    <div>
      <h1>Blue Magic</h1>
      <div className="muted">
        BLU {blu || "?"} · learned {learned.size}/{spells.length}{liveLearned && <span className="tag own" title="Synced from the game by the catseyecompanion addon">from game</span>} · {spells.filter((s) => s.level <= blu && !learned.has(s.name)).length} learnable now
        {!char && <> · <span className="link" onClick={() => go({ name: "character" })}>load your character</span> to filter by level</>}
      </div>
      <details className="cxnote">
        <summary>CatseyeXI Blue Mage changes <span className="tag cx">bg-wiki</span></summary>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{adjust?.replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, "$1").replace(/^=+.*=+$/gm, "").trim()}</pre>
        <a href={wikiUrl("CatsEyeXI_Systems/Jobs")} target="_blank">Full page</a>
      </details>
      <div className="row">
        <button className={tab === "spells" ? "active-tab" : ""} onClick={() => setTab("spells")}>Spells</button>
        <button className={tab === "set" ? "active-tab" : ""} onClick={() => setTab("set")}>Current set</button>
        <button className={tab === "traits" ? "active-tab" : ""} onClick={() => setTab("traits")}>Trait planner</button>
      </div>
      {tab === "set" ? <BluSet blu={blu} learned={learned} onSpell={showSpell} /> : tab === "traits" ? <BluTraits blu={blu} learned={learned} onSpell={showSpell} /> : <>
      <div className="row">
        <input placeholder="Filter spells" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
        <label><input type="checkbox" checked={filter.hideLearned} onChange={(e) => setFilter({ ...filter, hideLearned: e.target.checked })} /> Hide learned</label>
        <label><input type="checkbox" checked={filter.onlyLearnable} onChange={(e) => setFilter({ ...filter, onlyLearnable: e.target.checked })} /> Only ≤ my level</label>
      </div>
      <p className="muted">To learn a spell, use BLU as main job and defeat a mob that gives EXP while it uses the ability.</p>
      <table>
        <thead><tr><th></th><th>Spell</th><th>Lv</th><th>Pts</th><th>Learn from</th></tr></thead>
        <tbody>
          {shown.map((s) => (
            <SpellRow key={s.name} s={s} learned={learned.has(s.name)} canLearn={s.level <= blu} locked={fromGame(s)}
              where={history.get(s.name) && [history.get(s.name)!.mob, zoneName(history.get(s.name)!.zoneid)].filter(Boolean).join(", ")}
              open={open === s.name} onOpen={() => setOpen(open === s.name ? undefined : s.name)} onToggle={() => toggle(s.name)} />
          ))}
        </tbody>
      </table>
      </>}
    </div>
  );
}

function SpellRow({ s, learned, canLearn, locked, where, open, onOpen, onToggle }: { s: Spell; learned: boolean; canLearn: boolean; locked: boolean; where?: string; open: boolean; onOpen: () => void; onToggle: () => void }) {
  const { go } = useApp();
  const [sources, setSources] = useState<Source[]>();
  const [pick, setPick] = useState<Source>();
  const [pts, setPts] = useState<{ x: number; z: number; label: string }[]>([]);
  const [showAll, setShowAll] = useState(false);
  // CatseyeXI is a 75-cap server: hide lv1 placeholder spawns, mobs above 75, and Adoulin-era zones (id >= 256).
  const inEra = (r: Source) => !!r.era;
  const list = showAll ? sources : sources?.filter(inEra);
  const hidden = (sources?.length ?? 0) - (sources?.filter(inEra).length ?? 0);

  useEffect(() => {
    if (!open || sources) return;
    // Levels are CatseyeXI's where the build fetched them (mob_index.cx_*); era = CatseyeXI content within reach.
    q<Source>(`SELECT s.mobname, s.zoneid, z.name zone, count(*) n, coalesce(mi.cx_lo, min(s.minLevel)) lo,
                      coalesce(mi.cx_hi, max(s.maxLevel)) hi, mi.cx_lo IS NOT NULL cx, coalesce(mi.era, 0) era
               FROM blu_sources s LEFT JOIN zones z USING (zoneid)
               LEFT JOIN mob_index mi ON mi.mobname = s.mobname AND mi.zoneid = s.zoneid
               WHERE s.spellid=$1 GROUP BY s.mobname, s.zoneid ORDER BY lo`, s.spellid).then(setSources);
  }, [open]);

  useEffect(() => {
    if (!pick) return;
    q("SELECT x, z FROM blu_sources WHERE spellid=$1 AND mobname=$2 AND zoneid=$3", s.spellid, pick.mobname, pick.zoneid)
      .then((r) => setPts(r.map((p: any) => ({ x: p.x, z: p.z, label: pretty(pick.mobname) }))));
  }, [pick]);

  return (
    <>
      <tr className="click" onClick={onOpen}>
        <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={learned} onChange={onToggle} disabled={locked} title={locked ? "Synced from the game" : undefined} /></td>
        <td className={canLearn ? "" : "muted"}>{s.name} {s.content_tag === "CATSEYE" && <span className="tag cx">CX only</span>}{where && <span className="tag own" title="Where you learned it">{where}</span>}</td>
        <td>{s.level}{s.lsb_level && s.lsb_level !== s.level ? <span className="tag cx">retail {s.lsb_level}</span> : null}</td>
        <td className="muted">{s.set_points ?? ""}</td>
        <td>{s.cx_notes ? <span style={{ color: "var(--cx)" }}>{s.cx_notes}</span> : <span className="muted">{open ? "" : "click for mobs"}</span>}</td>
      </tr>
      {open && (
        <tr><td></td><td colSpan={4}>
          {s.cx_notes && <div className="cxnote">CatseyeXI: {s.cx_notes}</div>}
          {!list ? "Loading…" : !list.length && !hidden ? <span className="muted">No LSB spawn data. Follow the CatseyeXI note above.</span> : (
            <table>
              <tbody>
                {list.map((src) => (
                  <tr key={src.mobname + src.zoneid} className="click" onClick={() => setPick(src)}
                    style={pick === src ? { background: "#232838" } : {}}>
                    <td><span className="link" onClick={(e) => { e.stopPropagation(); go({ name: "mob", mob: src.mobname }); }}>{pretty(src.mobname)}</span></td>
                    <td>{src.zone}</td><td className="muted">Lv{src.lo}-{src.hi}{!!src.cx && <span className="tag cx">CX</span>}</td><td className="muted">{src.n} spawns</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {hidden > 0 && (
            <div className="link muted" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Hide" : "Show"} {hidden} source{hidden > 1 ? "s" : ""} that aren't CatseyeXI content (placeholders, mobs above 85, retail-only zones)
            </div>
          )}
          {pick && <ZoneMap zoneid={pick.zoneid} points={pts} />}
          <a href={wikiUrl(s.name)} target="_blank">bg-wiki: {s.name}</a>
        </td></tr>
      )}
    </>
  );
}
