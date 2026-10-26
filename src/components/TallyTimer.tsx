import { useEffect, useState } from "react";
import { dhm, nextDaily, nextTally } from "../ffxi";

// Sidebar countdowns to the daily reset and the weekly conquest tally, refreshed every 20s.
export default function TallyTimer() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20000); return () => clearInterval(t); }, []);
  const at = nextTally(now), day = nextDaily(now);
  return (<>
    <div className="tally" title={`Daily reset (ventures, daily quests): ${new Date(day).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} your time (midnight JST)`}>
      <span className="muted">Daily reset</span> <b>{dhm(day - now)}</b>
    </div>
    <div className="tally" title={`Weekly conquest tally: ${new Date(at).toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" })} your time (midnight JST, Monday)`}>
      <span className="muted">Weekly tally</span> <b>{dhm(at - now)}</b>
    </div>
  </>);
}
