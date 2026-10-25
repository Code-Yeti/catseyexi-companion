import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { q } from "../db";
import { SC_LEVEL, SC_NAMES, skillchain } from "../ffxi";

type Skill = { kind: "ws" | "blu"; id: number; name: string; weapon: string; tag: string | null; lvl: number; sc1: number; sc2: number; sc3: number };
const key = (s: Skill) => `${s.kind}:${s.id}`;
const props = (s: Skill) => [s.sc1, s.sc2, s.sc3].filter(Boolean);
// Element colours: Liquefaction fire, Scission earth, Reverberation water, Detonation wind, Induration ice, Impaction lightning,
// Compression dark, Transfixion light; level 2s blend their two elements.
const SC_COLOR = ["", "#f2f2e6", "#a383e0", "#ef6b6b", "#c9a46a", "#5aa5f0", "#5fd18b", "#7fe0ef", "#c58cff",
  "#a07850", "#4fc3b0", "#f0a04c", "#a8e05a", "#ffe9a8", "#8c5cd6"];
const PH = 28, RH = 56; // partner and result row heights

function Pick({ label, value, skills, onChange }: { label: string; value?: Skill; skills: Skill[]; onChange: (s?: Skill) => void }) {
  const groups = useMemo(() => [...new Set(skills.map((s) => s.weapon))], [skills]);
  return (
    <label className="job" style={{ textAlign: "left", minWidth: 280 }}>
      {label}
      <select style={{ width: "100%", marginTop: 4 }} value={value ? key(value) : ""} onChange={(e) => onChange(skills.find((s) => key(s) === e.target.value))}>
        <option value="">—</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {skills.filter((s) => s.weapon === g).map((s) => <option key={key(s)} value={key(s)}>{s.name}{s.tag ? ` (${s.tag})` : ""}</option>)}
          </optgroup>
        ))}
      </select>
      {value && <div style={{ marginTop: 4 }}>{props(value).map((p) => <ScTag key={p} sc={p} />)}</div>}
    </label>
  );
}
const ScTag = ({ sc }: { sc: number }) => <span className="tag" style={{ color: SC_COLOR[sc], borderColor: SC_COLOR[sc] }}>{SC_NAMES[sc]}</span>;

// Pick an opener and a closer to see what they make; pick one to see every partner skill, grouped by the skillchain.
export default function Skillchains() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [opener, setOpener] = useState<Skill>();
  const [closer, setCloser] = useState<Skill>();
  const [cat, setCat] = useState("All");
  const [only, setOnly] = useState<number>(); // narrow to one skillchain

  useEffect(() => {
    q<Skill>("SELECT * FROM sc_skills ORDER BY kind = 'ws', weapon, lvl, name").then(setSkills);
  }, []);

  const one = opener && !closer ? opener : !opener && closer ? closer : undefined;
  const asOpener = !!opener;
  const cats = ["All", ...new Set(skills.map((s) => s.weapon))];
  // Partners of the one picked skill, with what each pair makes, grouped by skillchain (highest level first).
  const groups = useMemo(() => {
    if (!one) return [];
    const m = new Map<number, Skill[]>();
    for (const s of skills) {
      if (s === one || (cat !== "All" && s.weapon !== cat)) continue;
      const r = asOpener ? skillchain(props(one), props(s)) : skillchain(props(s), props(one));
      if (r) m.set(r, [...(m.get(r) ?? []), s]);
    }
    return [...m.entries()].sort((a, b) => SC_LEVEL(b[0]) - SC_LEVEL(a[0]) || a[0] - b[0])
      .filter(([r]) => only === undefined || r === only).map(([sc, list]) => ({ sc, list }));
  }, [one, asOpener, skills, cat, only]);

  const pickPartner = (s: Skill) => (asOpener ? setCloser(s) : setOpener(s));
  let row = 0;
  const placed = groups.map((g) => { const top = row; row += g.list.length; return { ...g, top, mid: (top + g.list.length / 2) * PH }; });
  const height = Math.max(row * PH, RH);

  return (
    <div>
      <h1>Skillchains</h1>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <Pick label="Opener (first)" value={opener} skills={skills} onChange={(s) => { setOpener(s); setOnly(undefined); }} />
        <button style={{ marginTop: 22 }} title="Swap" onClick={() => { setOpener(closer); setCloser(opener); }}>⇄</button>
        <Pick label="Closer (second)" value={closer} skills={skills} onChange={(s) => { setCloser(s); setOnly(undefined); }} />
      </div>

      {opener && closer && (() => {
        const r = skillchain(props(opener), props(closer)), back = skillchain(props(closer), props(opener));
        return (
          <div className="card sc-result">
            {opener.name} → {closer.name}:{" "}
            {r ? <b style={{ color: SC_COLOR[r] }}>{SC_NAMES[r]}</b> : <b className="muted">no skillchain</b>}
            {r && <span className="muted"> (level {SC_LEVEL(r)})</span>}
            {back && back !== r && <div className="muted">The other way round ({closer.name} → {opener.name}) makes <b style={{ color: SC_COLOR[back] }}>{SC_NAMES[back]}</b>.</div>}
          </div>
        );
      })()}

      {!opener && !closer && <p className="muted">Pick one skill to see everything it chains with, or two to see what they make.</p>}

      {one && (
        <>
          <div className="row">
            <span className="muted">{asOpener ? "Closers for" : "Openers for"} <b>{one.name}</b></span>
            <select value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
            {only !== undefined && <button onClick={() => setOnly(undefined)}>Show every skillchain</button>}
            <span className="muted">{groups.reduce((a, g) => a + g.list.length, 0)} skills</span>
          </div>
          {!groups.length ? <p className="muted">Nothing in {cat} chains with it.</p> : (
            <div className="sc-graph" style={{ height }}>
              <div className="sc-col"><div className="sc-node" style={{ top: 0, height: RH - 8 }}><b>{one.name}</b><div>{props(one).map((p) => <ScTag key={p} sc={p} />)}</div></div></div>
              <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} className="set-lines">
                {placed.map((g) => <path key={g.sc} stroke={SC_COLOR[g.sc]} strokeWidth={1 + SC_LEVEL(g.sc)}
                  style={{ d: `path("M0 ${(RH - 8) / 2} C50 ${(RH - 8) / 2} 50 ${g.mid} 100 ${g.mid}")` } as CSSProperties} />)}
              </svg>
              <div className="sc-col">
                {placed.map((g) => (
                  <div key={g.sc} className="sc-node click" style={{ top: g.mid - (RH - 8) / 2, height: RH - 8, borderColor: SC_COLOR[g.sc] }}
                    title={only === g.sc ? "Show every skillchain" : "Only this skillchain"} onClick={() => setOnly(only === g.sc ? undefined : g.sc)}>
                    <b style={{ color: SC_COLOR[g.sc] }}>{SC_NAMES[g.sc]}</b><div className="muted">level {SC_LEVEL(g.sc)} · {g.list.length} skills</div>
                  </div>
                ))}
              </div>
              <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} className="set-lines">
                {placed.map((g) => g.list.map((s, i) => {
                  const y = (g.top + i) * PH + PH / 2 - 2;
                  return <path key={key(s)} stroke={SC_COLOR[g.sc]} strokeWidth={1.2} opacity={0.7}
                    style={{ d: `path("M0 ${g.mid} C50 ${g.mid} 50 ${y} 100 ${y}")` } as CSSProperties} />;
                }))}
              </svg>
              <div className="sc-col">
                {placed.map((g) => g.list.map((s, i) => (
                  <Fragment key={key(s)}>
                    <div className="sc-partner click" style={{ top: (g.top + i) * PH, height: PH - 4 }} onClick={() => pickPartner(s)} title={`Use as ${asOpener ? "closer" : "opener"}`}>
                      <span>{s.name}</span><span className="muted">{s.tag ?? (s.kind === "blu" ? `BLU ${s.lvl}` : s.weapon)}</span>
                    </div>
                  </Fragment>
                )))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
