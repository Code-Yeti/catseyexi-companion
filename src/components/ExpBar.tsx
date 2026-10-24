import { useEffect, useRef, useState } from "react";
import { useApp } from "../ctx";
import { expGain, jobName, type ExpSnap } from "../ffxi";

const WINDOW = 30 * 60; // rate = points gained over the last 30 minutes of this session

const dur = (s: number) => s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.max(1, Math.round(s / 60))}m`;
const n = (x: number) => Math.round(x).toLocaleString();

// EXP (or limit points in limit mode) bar for the sidebar, with a rate per hour and time to the next level or merit.
// Needs the addon; tracking lives in memory, so it starts fresh with each app launch.
export default function ExpBar() {
  const { live } = useApp();
  const prev = useRef<ExpSnap | undefined>(undefined);
  const gains = useRef<{ t: number; g: number }[]>([]);
  const start = useRef(0);
  const [, tick] = useState(0);

  const e = live?.exp;
  useEffect(() => {
    if (!live || !e) return;
    const snap: ExpSnap = { job: live.mainJob, lvl: live.mainLevel, cur: e.cur, need: e.need, limit: e.limit, merits: e.merits };
    const now = Date.now() / 1000;
    const g = prev.current ? expGain(prev.current, snap) : 0;
    if (g === null || !start.current) { gains.current = []; start.current = now; } // new session or job change
    else if (g > 0) gains.current.push({ t: now, g });
    gains.current = gains.current.filter((x) => now - x.t < WINDOW);
    prev.current = snap;
    tick((x) => x + 1);
  }, [live?.ts, e?.cur, e?.limit, e?.merits, live?.mainJob, live?.mainLevel]);

  if (!live || !e) return null;
  const now = Date.now() / 1000;
  const elapsed = Math.min(WINDOW, now - start.current);
  const total = gains.current.reduce((a, x) => a + x.g, 0);
  const perHour = elapsed >= 60 && total > 0 ? (total / elapsed) * 3600 : 0;
  const limitMode = e.limitMode && live.mainLevel >= 75;
  const [cur, max] = limitMode ? [e.limit, 10000] : [e.cur, e.need];
  const eta = perHour ? ((max - cur) / perHour) * 3600 : 0;

  return (
    <div className="exp-bar" title={`Rate over the last ${dur(elapsed)}`}>
      <div className="row" style={{ margin: 0, justifyContent: "space-between" }}>
        <span>{jobName(live.mainJob)} {live.mainLevel}</span>
        <span className="muted">{limitMode ? `Merits ${e.merits}/${e.meritsMax}` : "EXP"}</span>
      </div>
      <div className={limitMode ? "bar limit" : "bar"}><div style={{ width: `${Math.min(100, (cur / Math.max(1, max)) * 100)}%` }} /></div>
      <div className="muted">{n(cur)} / {n(max)}</div>
      {perHour > 0
        ? <div className="muted">{n(perHour)}/hr · {limitMode ? "merit" : "level"} in ~{dur(eta)}</div>
        : <div className="muted">{elapsed < 60 ? "Measuring rate…" : "No gains in 30 min"}</div>}
    </div>
  );
}
