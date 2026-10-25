import { useEffect, useState } from "react";
import { dhm, nextTally } from "../ffxi";

// Sidebar countdown to the weekly conquest tally, refreshed every 20s.
export default function TallyTimer() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20000); return () => clearInterval(t); }, []);
  const at = nextTally(now);
  return (
    <div className="tally" title={`Weekly conquest tally: ${new Date(at).toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" })} your time (midnight JST, Monday)`}>
      <span className="muted">Conquest tally</span> <b>{dhm(at - now)}</b>
    </div>
  );
}
