import { useEffect, useState } from "react";
import { useApp } from "../ctx";
import { q, uq } from "../db";

type Info = { mobname: string; lo: number; hi: number; cx: number; aggro: number; links: number; truesight: number; family: string | null; blu: string | null };

// Floating card for the in-game target (addon only): level, flags, and blue magic it teaches you haven't learned.
export default function TargetCard() {
  const { live, liveLearned, go } = useApp();
  const t = live?.target?.mob ? live.target : undefined;
  const [info, setInfo] = useState<Info | null>();
  const [learned, setLearned] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<string>();

  const key = t ? `${t.name}|${live!.zone}` : "";
  useEffect(() => {
    if (!t) return setInfo(undefined);
    const mobname = t.name.replace(/ /g, "_");
    q<Info>(`SELECT mobname, coalesce(cx_lo, lo) lo, coalesce(cx_hi, hi) hi, cx_lo IS NOT NULL cx, aggro, links, truesight, family, blu
             FROM mob_index WHERE mobname=$1 ORDER BY zoneid=$2 DESC LIMIT 1`, mobname, live!.zone).then((r) => setInfo(r[0] ?? null));
    if (!liveLearned) uq<{ name: string }>("SELECT name FROM blu_learned").then((r) => setLearned(new Set(r.map((x) => x.name))));
  }, [key]);

  if (!t || hidden === key) return null;
  const have = liveLearned ?? learned;
  const spells = info?.blu?.split(", ") ?? [];
  const missing = spells.filter((s) => !have.has(s));

  return (
    <div className="target-card">
      <div className="row" style={{ margin: 0, justifyContent: "space-between" }}>
        <b className="link" onClick={() => info && go({ name: "mob", mob: info.mobname })}>{t.name}</b>
        <span className="link muted" onClick={() => setHidden(key)}>✕</span>
      </div>
      {info === null ? <div className="muted">Not in the database</div> : info && (
        <>
          <div className="muted">
            Lv{info.lo === info.hi ? info.lo : `${info.lo}-${info.hi}`}{!!info.cx && <span className="tag cx">CX</span>}
            {" "}{info.family}
            {!!info.aggro && <span className="tag" style={{ color: "var(--bad)" }}>A</span>}
            {!!info.links && <span className="tag" style={{ color: "var(--warn)" }}>L</span>}
            {!!info.truesight && <span className="tag">TS</span>}
            <span style={{ float: "right" }}>{t.hpp}%</span>
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
    </div>
  );
}
