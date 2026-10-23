import { useEffect, useMemo, useState } from "react";
import { useApp } from "../ctx";
import { q } from "../db";
import { pretty } from "../ffxi";
import { CONTAINERS } from "../live";

// Every bag, from the game addon. Without it, falls back to catseyexi.com's owned-items list (no bags or counts).
export default function Storage() {
  const { live, owned, go } = useApp();
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [text, setText] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set(["0"]));

  const bags = live?.storage ?? null;
  const ids = useMemo(() => [...new Set(bags ? Object.values(bags).flat().map(([id]) => id) : [...owned])], [bags, owned]);
  const idKey = ids.join(",");
  useEffect(() => {
    if (!ids.length) return;
    q<{ itemid: number; name: string }>(`SELECT itemid, name FROM item_basic WHERE itemid IN (${ids.map(Number).join(",")})`)
      .then((r) => setNames(new Map(r.map((i) => [i.itemid, pretty(i.name)]))));
  }, [idKey]);

  const t = text.trim().toLowerCase();
  const label = (id: number) => names.get(id) ?? `#${id}`;
  const match = (id: number) => !t || label(id).toLowerCase().includes(t);

  if (!bags) {
    const list = ids.filter(match).sort((a, b) => label(a).localeCompare(label(b)));
    return (
      <div>
        <h1>Storage</h1>
        <p className="muted">Connect the game addon (Settings) to see every bag with counts. This is catseyexi.com's owned-items list.</p>
        <input placeholder="Search items" value={text} onChange={(e) => setText(e.target.value)} style={{ width: 300 }} />
        <table style={{ marginTop: 10 }}><tbody>
          {list.map((id) => <tr key={id} className="click" onClick={() => go({ name: "item", id })}><td>{label(id)}</td></tr>)}
        </tbody></table>
      </div>
    );
  }

  const order = Object.keys(CONTAINERS).filter((c) => bags[c]?.length); // empty bags hidden
  const total = order.reduce((a, c) => a + bags[c].length, 0);
  return (
    <div>
      <h1>Storage <span className="tag own">live</span></h1>
      <div className="row">
        <input placeholder="Search all bags" value={text} onChange={(e) => setText(e.target.value)} style={{ width: 300 }} />
        <span className="muted">{total} items in {order.length} bags</span>
        <button onClick={() => setOpen(new Set(order))}>Expand all</button>
        <button onClick={() => setOpen(new Set())}>Collapse all</button>
      </div>
      {order.map((c) => {
        const items = bags[c].filter(([id]) => match(id)).sort((a, b) => label(a[0]).localeCompare(label(b[0])));
        if (t && !items.length) return null;
        const isOpen = !!t || open.has(c);
        return (
          <div key={c} className="card">
            <div className="click link" onClick={() => setOpen((o) => { const n = new Set(o); n.has(c) ? n.delete(c) : n.add(c); return n; })}>
              <b>{CONTAINERS[c]}</b> <span className="muted">{t ? `${items.length} match` : bags[c].length}</span> {isOpen ? "▾" : "▸"}
            </div>
            {isOpen && (
              <table style={{ marginTop: 6 }}><tbody>
                {items.map(([id, count], i) => (
                  <tr key={id + "-" + i} className="click" onClick={() => go({ name: "item", id })}>
                    <td>{label(id)}</td><td className="muted" style={{ width: 60, textAlign: "right" }}>{count > 1 ? `×${count}` : ""}</td>
                  </tr>
                ))}
                {!items.length && <tr><td className="muted">Empty</td></tr>}
              </tbody></table>
            )}
          </div>
        );
      })}
    </div>
  );
}
