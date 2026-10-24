import { useEffect, useRef, useState } from "react";
import { useApp } from "../ctx";
import { q, uq } from "../db";
import { pretty } from "../ffxi";
import { usePrefs, chime } from "../prefs";

type Info = { mobname: string; lo: number; hi: number; cx: number; aggro: number; links: number; truesight: number; family: string | null; blu: string | null };
type Skill = { id: number; name: string; spell: string | null };

// Floating card for the in-game target (addon only): level, flags, and blue magic it teaches you haven't learned.
// While engaged it grows into a combat card: HP bar, what the target is readying, and its recent TP moves,
// flagged when one of them teaches a spell you're missing.
export default function TargetCard() {
  const { live, liveLearned, go } = useApp();
  const t = live?.target?.mob ? live.target : undefined;
  const [info, setInfo] = useState<Info | null>();
  const [learned, setLearned] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<string>();
  const [skills, setSkills] = useState<Map<number, Skill>>(new Map());
  const [prefs] = usePrefs();
  const chimed = useRef(0); // time of the newest move we've already chimed for

  const key = t ? `${t.id}|${t.name}|${live!.zone}` : "";
  useEffect(() => {
    if (!t) return setInfo(undefined);
    let current = true; // ignore answers that arrive after you've switched targets
    const cols = "mi.mobname, coalesce(cx_lo, lo) lo, coalesce(cx_hi, hi) hi, cx_lo IS NOT NULL cx, aggro, links, truesight, family, blu";
    // Exact: the client's server id is LSB's mobid (CatseyeXI forked LSB's SQL). Fallback: the name, preferring this zone.
    (async () => {
      const byId = await q<Info>(`SELECT ${cols} FROM mob_spawn_points sp JOIN mob_groups g ON g.groupid = sp.groupid AND g.zoneid = $2
        JOIN mob_index mi ON mi.poolid = g.poolid AND mi.zoneid = g.zoneid WHERE sp.mobid = $1 LIMIT 1`, t.id, (t.id >> 12) & 4095); // zone is encoded in the id
      const r = byId.length ? byId : await q<Info>(`SELECT ${cols} FROM mob_index mi WHERE lower(mobname) = lower($1) ORDER BY zoneid = $2 DESC LIMIT 1`,
        t.name.replace(/ /g, "_"), live!.zone);
      if (current) setInfo(r[0] ?? null);
    })();
    return () => { current = false; };
  }, [key]);
  useEffect(() => {
    if (!liveLearned) uq<{ name: string }>("SELECT name FROM blu_learned").then((r) => setLearned(new Set(r.map((x) => x.name))));
  }, [liveLearned]);

  // Server ids belong to the spawn slot, so a respawn (or the same mob in a later fight) reuses them:
  // only count moves since you picked this target or last drew weapons on it.
  const [since, setSince] = useState(0);
  const prev = useRef<{ id?: number; engaged: boolean }>({ engaged: false });
  useEffect(() => {
    const engaged = !!live?.engaged;
    if (t?.id !== prev.current.id || (engaged && !prev.current.engaged)) setSince(Date.now() / 1000 - 2);
    prev.current = { id: t?.id, engaged };
  }, [t?.id, live?.engaged]);
  const moves = (live?.moves ?? []).filter((m) => t && m.actor === t.id && m.time >= since).reverse(); // newest first
  const unknownIds = [...new Set(moves.map((m) => m.skill))].filter((id) => !skills.has(id));
  useEffect(() => {
    if (!unknownIds.length) return;
    // Exact mob_skill_id match: LSB only teaches a spell from the specific skill id in blue_spell_list.
    q<Skill>(`SELECT ms.mob_skill_id id, ms.mob_skill_name name, s.name spell FROM mob_skills ms
              LEFT JOIN blu_spell_skills k ON k.mob_skill_id = ms.mob_skill_id LEFT JOIN blu_spells s ON s.spellid = k.spellid
              WHERE ms.mob_skill_id IN (${unknownIds.map(Number).join(",")})`)
      .then((r) => setSkills((m) => new Map([...m, ...unknownIds.map((id): [number, Skill] => [id, r.find((x) => x.id === id) ?? { id, name: `Ability #${id}`, spell: null }])])));
  }, [unknownIds.join(",")]);

  const have = liveLearned ?? learned;
  const teachesMissing = (m: { skill: number }) => { const s = skills.get(m.skill); return !!s?.spell && !have.has(s.spell); };
  // Chime once per new used move that teaches a spell you're missing, even while the card is hidden.
  const newest = moves.find((m) => !m.ready && teachesMissing(m)); // only on use: a readied move can still be stunned
  useEffect(() => {
    if (!newest || newest.time <= chimed.current) return;
    if (prefs.soundLearnable && Date.now() / 1000 - newest.time < 10) chime("learnable"); // old moves after a (re)load: no chime
    chimed.current = newest.time;
  }, [newest?.time, newest?.skill]);

  // Animate size changes: CSS can't transition height:auto, so measure the content and set the card's height from it.
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number>();
  const shown = !!t && hidden !== key;
  useEffect(() => {
    if (!shown || !inner.current) return setH(undefined);
    const ro = new ResizeObserver(() => setH(inner.current?.offsetHeight)); // offsetHeight ignores the scale setting
    ro.observe(inner.current);
    return () => ro.disconnect();
  }, [shown]);

  if (!t || hidden === key) return null;
  const spells = info?.blu?.split(", ") ?? [];
  const missing = spells.filter((s) => !have.has(s));
  const combat = !!live?.engaged;
  const now = Date.now() / 1000;
  const readying = moves[0]?.ready && now - moves[0].time < 6 ? skills.get(moves[0].skill) : undefined;
  const used = moves.filter((m) => !m.ready).slice(0, 4);
  const learnable = skills.get(used.find(teachesMissing)?.skill ?? -1);

  return (
    <div className={`target-card ${prefs.cardCorner}${combat ? " combat" : ""}`} style={{ scale: String(prefs.cardScale), height: h == null ? undefined : h + 2 }}>
      <div ref={inner} className="tc-inner">
      <div className="row" style={{ margin: 0, justifyContent: "space-between" }}>
        <b className="link" onClick={() => info && go({ name: "mob", mob: info.mobname })}>{combat && "⚔ "}{t.name}</b>
        <span className="link muted" onClick={() => setHidden(key)}>✕</span>
      </div>
      {combat && <div className="hp-bar"><div style={{ width: `${t.hpp}%` }} /><span>{t.hpp}%</span></div>}
      {info === null ? <div className="muted">Not in the database</div> : info && (
        <>
          <div className="muted">
            Lv{info.lo === info.hi ? info.lo : `${info.lo}-${info.hi}`}{!!info.cx && <span className="tag cx">CX</span>}
            {" "}{info.family}
            {!!info.aggro && <span className="tag" style={{ color: "var(--bad)" }}>A</span>}
            {!!info.links && <span className="tag" style={{ color: "var(--warn)" }}>L</span>}
            {!!info.truesight && <span className="tag">TS</span>}
            {!combat && <span style={{ float: "right" }}>{t.hpp}%</span>}
          </div>
          {spells.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {spells.map((s) => (
                <span key={s} className={missing.includes(s) ? "tag cx" : "tag"} title={missing.includes(s) ? "Not learned yet" : "Learned"}>
                  {missing.includes(s) ? "★ " : "✓ "}{s}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {combat && readying && <div className="readying">Readying {pretty(readying.name)}{readying.spell && !have.has(readying.spell) && " ★"}</div>}
      {learnable && <div className="learnable">★ Used {pretty(learnable.name)}: teaches <b>{learnable.spell}</b></div>}
      {combat && used.length > 0 && (
        <div className="muted" style={{ marginTop: 4 }}>
          Recent: {used.map((m, i) => {
            const s = skills.get(m.skill);
            return <span key={i} className="tag">{s ? pretty(s.name) : "…"}{s?.spell && (have.has(s.spell) ? " ✓" : " ★")}</span>;
          })}
        </div>
      )}
      </div>
    </div>
  );
}
