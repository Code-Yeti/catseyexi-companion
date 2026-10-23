import { useState } from "react";
import { useApp } from "../ctx";
import { parseCharId } from "../catseye";
import { jobName } from "../ffxi";

export default function Friends() {
  const { friends, addFriend, removeFriend, refreshFriends, zoneName, toasts, setToasts, toast } = useApp();
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const id = parseCharId(input);
    if (!id) return setErr("Paste a CatseyeXI character URL like https://catseyexi.com/char/12345");
    setBusy(true); setErr(undefined);
    try { await addFriend(id); setInput(""); } catch (e) { setErr(`Couldn't load character ${id}: ${e}`); }
    setBusy(false);
  };

  const sorted = [...friends].sort((a, b) => +!!b.char?.isOnline - +!!a.char?.isOnline || (a.char?.charname ?? a.id).localeCompare(b.char?.charname ?? b.id));
  const last = Math.max(0, ...friends.map((f) => f.checked ?? 0));

  return (
    <div>
      <h1>Friends</h1>
      <div className="row">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Friend's catseyexi.com/char/… URL"
          style={{ width: 380 }} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button onClick={add} disabled={busy}>Add</button>
        <button onClick={() => refreshFriends()}>Refresh now</button>
        {last > 0 && <span className="muted">Checked {new Date(last).toLocaleTimeString()} · rechecks every 3 min while the app is open</span>}
      </div>
      <div className="row">
        <label><input type="checkbox" checked={toasts} onChange={(e) => setToasts(e.target.checked)} /> Pop-up when a friend comes online</label>
        <button onClick={() => toast("Test friend is online", "Konschtat Highlands")}>Test popup</button>
      </div>
      {err && <div className="error">{err}</div>}
      <table>
        <thead><tr><th></th><th>Name</th><th>Job</th><th>Zone</th><th></th></tr></thead>
        <tbody>
          {sorted.map((f) => (
            <tr key={f.id}>
              <td style={{ width: 24 }}><span className={f.char?.isOnline ? "dot-on" : "dot-off"} title={f.char?.isOnline ? "Online" : "Offline"} /></td>
              <td><a href={`https://catseyexi.com/char/${f.id}`} target="_blank">{f.char?.charname ?? `#${f.id}`}</a>
                {f.err && <span className="warn" title={f.err}> (couldn't refresh)</span>}</td>
              <td className="muted">{f.char ? `${jobName(f.char.mjob)}${f.char.mlvl}/${jobName(f.char.sjob)}${f.char.slvl}` : ""}</td>
              <td className="muted">{f.char ? (f.char.isOnline ? "" : "last seen in ") + (zoneName(f.char.pos_zone) ?? f.char.pos_zone) : ""}</td>
              <td><button onClick={() => removeFriend(f.id)}>Remove</button></td>
            </tr>
          ))}
          {!friends.length && <tr><td colSpan={5} className="muted">No friends added yet. Paste their CatseyeXI profile URL above.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
