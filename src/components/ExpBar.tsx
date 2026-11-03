import { useEffect, useState } from "react";
import { useApp } from "../ctx";
import { expGain, jobName, type ExpSnap } from "../ffxi";
import type { Live } from "../live";

const WINDOW = 30 * 60; // rate = points gained over the last 30 minutes of this session

const dur = (s: number) => s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.max(1, Math.round(s / 60))}m`;
const n = (x: number) => Math.round(x).toLocaleString();

// Tracking is shared by every ExpBar (sidebar and Training) and fed once per addon write. It lives in memory, so it starts
// fresh with each app launch.
const track = { ts: 0, prev: undefined as ExpSnap | undefined, gains: [] as { t: number; g: number }[], start: 0, session: 0, last: 0 };
function feed(live: Live) {
  const e = live.exp;
  if (!e || live.ts === track.ts) return;
  track.ts = live.ts;
  const snap: ExpSnap = { job: live.mainJob, lvl: live.mainLevel, cur: e.cur, need: e.need, limit: e.limit, merits: e.merits };
  const now = Date.now() / 1000;
  const g = track.prev ? expGain(track.prev, snap) : 0;
  if (g === null || !track.start) { track.gains = []; track.start = now; track.session = 0; } // new session or job change
  else if (g > 0) { track.gains.push({ t: now, g }); track.session += g; track.last = g; }
  track.gains = track.gains.filter((x) => now - x.t < WINDOW);
  track.prev = snap;
}

// EXP (or limit points in limit mode) bar with a rate per hour and time to the next level or merit. Needs the addon.
// big: the Training page version, with session totals.
export default function ExpBar({ big }: { big?: boolean }) {
  const { live } = useApp();
  const [, tick] = useState(0);
  const e = live?.exp;
  useEffect(() => { if (live) { feed(live); tick((x) => x + 1); } }, [live?.ts]);

  if (!live || !e) return null;
  const now = Date.now() / 1000;
  const elapsed = Math.min(WINDOW, now - track.start);
  const total = track.gains.reduce((a, x) => a + x.g, 0);
  const perHour = elapsed >= 60 && total > 0 ? (total / elapsed) * 3600 : 0;
  const limitMode = e.limitMode && live.mainLevel >= 75;
  const [cur, max] = limitMode ? [e.limit, 10000] : [e.cur, e.need];
  const eta = perHour ? ((max - cur) / perHour) * 3600 : 0;
  const pct = Math.min(100, (cur / Math.max(1, max)) * 100);

  return (
    <div className={big ? "exp-bar big card" : "exp-bar"} title={`Rate over the last ${dur(elapsed)}`}>
      <div className="row" style={{ margin: 0, justifyContent: "space-between" }}>
        <span>{jobName(live.mainJob)} {live.mainLevel}</span>
        <span className="muted">{limitMode ? `Merits ${e.merits}/${e.meritsMax}` : "EXP"}</span>
      </div>
      <div className={limitMode ? "bar limit" : "bar"}><div style={{ width: `${pct}%` }} /></div>
      <div className="muted">{n(cur)} / {n(max)}{big && ` · ${pct.toFixed(1)}% · ${n(max - cur)} to ${limitMode ? "merit" : "level"}`}</div>
      {perHour > 0
        ? <div className="muted">{n(perHour)}/hr · {limitMode ? "merit" : "level"} in ~{dur(eta)}</div>
        : <div className="muted">{elapsed < 60 ? "Measuring rate…" : "No gains in 30 min"}</div>}
      {big && track.session > 0 && <div className="muted">This session: +{n(track.session)} · last +{n(track.last)}</div>}
    </div>
  );
}
