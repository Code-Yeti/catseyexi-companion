import { useEffect, useRef, useState } from "react";
import { q, uq, uexec } from "../db";
import { useApp } from "../ctx";
import { localMap, type ZoneMapRow } from "../maps";
import { fitMap, type Pair } from "../ffxi";

export type Pt = { x: number; z: number; label: string };
type Fit = { a: number; b: number; c: number; d: number }; // px = a*x + b, py = c*z + d (image pixels)

// Zone map from bg-wiki with spawn dots. Most outdoor maps are auto-calibrated at build time (zone lines + NPC
// positions); for the rest, "Fit dots" lets you drag/scroll the zone's spawn cloud onto the map's marked mob areas,
// or — with the catseyecompanion addon — "Mark my position" pairs clicks on the map with your live in-game position.
export default function ZoneMap({ zoneid, points }: { zoneid: number; points: Pt[] }) {
  const { char, live } = useApp();
  const [marks, setMarks] = useState<Pair[] | null>(null); // non-null while marking positions
  const [maps, setMaps] = useState<ZoneMapRow[]>();
  const [floor, setFloor] = useState(0);
  const [src, setSrc] = useState<string>();
  const [err, setErr] = useState<string>();
  const [saved, setSaved] = useState<Fit | null>(null);
  const [draft, setDraft] = useState<Fit | null>(null); // non-null while fitting
  const [cloud, setCloud] = useState<{ x: number; z: number }[]>([]);
  const drag = useRef<{ x: number; y: number; fit: Fit } | null>(null);
  const box = useRef<HTMLDivElement>(null);   // the (zoomed) map content; toImg works through its scaled rect
  const frame = useRef<HTMLDivElement>(null); // fixed viewport around it
  // View zoom/pan (CSS transform on the content, origin top-left). tx/ty are in frame pixels.
  const [view, setView] = useState({ z: 1, tx: 0, ty: 0 });
  const pan = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const clampView = (v: { z: number; tx: number; ty: number }) => {
    const fw = frame.current?.clientWidth ?? 0, fh = frame.current?.clientHeight ?? 0;
    const z = Math.min(8, Math.max(1, v.z));
    return { z, tx: Math.min(0, Math.max(fw - fw * z, v.tx)), ty: Math.min(0, Math.max(fh - fh * z, v.ty)) };
  };
  const zoomAt = (f: number, cx?: number, cy?: number) => setView((v) => {
    const fw = frame.current?.clientWidth ?? 0, fh = frame.current?.clientHeight ?? 0;
    const x = cx ?? fw / 2, y = cy ?? fh / 2, z = Math.min(8, Math.max(1, v.z * f)), k = z / v.z;
    return clampView({ z, tx: x - (x - v.tx) * k, ty: y - (y - v.ty) * k });
  });

  useEffect(() => {
    q<ZoneMapRow>("SELECT * FROM zone_maps WHERE zoneid=$1 ORDER BY ord", zoneid).then((m) => { setMaps(m); setFloor(0); });
    q<{ x: number; z: number }>("SELECT DISTINCT round(x) x, round(z) z FROM spawns WHERE zoneid=$1 LIMIT 3000", zoneid).then(setCloud);
  }, [zoneid]);

  const m = maps?.[floor];
  useEffect(() => {
    if (!m) return;
    setSrc(undefined); setErr(undefined); setDraft(null); setMarks(null); setView({ z: 1, tx: 0, ty: 0 });
    localMap(m).then(setSrc).catch((e) => setErr(String(e)));
    uq<Fit>("SELECT a,b,c,d FROM map_fit WHERE file=$1", m.file).then((r) => setSaved(r[0] ?? null));
  }, [m?.file]);

  // Wheel: scales the dots while fitting, otherwise zooms the map toward the cursor. React's onWheel is passive and
  // can't stop the page scrolling, so attach natively.
  const fittingRef = useRef(false);
  fittingRef.current = draft !== null && !marks;
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (fittingRef.current) {
        const rect = box.current!.getBoundingClientRect(), W = m!.w, H = m!.h;
        const p = { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
        const f = e.deltaY < 0 ? 1.05 : 1 / 1.05;
        setDraft((d) => d && { a: d.a * f, c: d.c * f, b: p.x - f * (p.x - d.b), d: p.y - f * (p.y - d.d) });
      } else {
        const fr = el.getBoundingClientRect();
        zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - fr.left, e.clientY - fr.top);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [m?.file, !!src]);

  if (maps && !maps.length) return <Scatter points={points} />;
  if (!m) return null;

  const auto: Fit | null = m.a != null ? { a: m.a, b: m.b!, c: m.c!, d: m.d! } : null;
  const fit = draft ?? saved ?? auto;
  const W = m.w, H = m.h, r = W / 110 / Math.sqrt(view.z); // dots shrink a little as you zoom in

  const startFit = () => {
    if (fit) return setDraft(fit);
    // First guess: frame the zone's whole spawn cloud in the middle of the map.
    const pts = cloud.length ? cloud : points;
    const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 1);
    const s = (0.65 * W) / span;
    setDraft({ a: s, b: W / 2 - (s * (Math.max(...xs) + Math.min(...xs))) / 2, c: -s, d: H / 2 + (s * (Math.max(...zs) + Math.min(...zs))) / 2 });
  };
  const toImg = (e: { clientX: number; clientY: number }) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  };
  // Live position (addon, ~1s) beats the catseyexi.com position (3 min).
  const here = live && live.zone === zoneid ? live.pos : char?.pos_zone === zoneid ? { x: char.pos_x, z: char.pos_z } : null;
  const mark = (e: React.MouseEvent) => {
    if (dragged.current) { dragged.current = false; return; } // that was a pan, not a click
    if (!marks || !live || live.zone !== zoneid) return;
    const p = toImg(e);
    const next = [...marks, { x: live.pos.x, z: live.pos.z, px: p.x, py: p.y }];
    setMarks(next);
    const f = fitMap(next);
    setDraft(f ? { a: f.a, b: f.b, c: f.c, d: f.d } : null);
  };
  const save = async () => {
    await uexec("INSERT OR REPLACE INTO map_fit VALUES ($1,$2,$3,$4,$5)", m.file, draft!.a, draft!.b, draft!.c, draft!.d);
    setSaved(draft); setDraft(null); setMarks(null);
  };
  // Zoom in on your live dot.
  const centerOnMe = () => {
    if (!fit || !here || !frame.current) return;
    const fw = frame.current.clientWidth, fh = frame.current.clientHeight;
    const z = Math.max(view.z, 3), mx = ((fit.a * here.x + fit.b) / W) * fw, my = ((fit.c * here.z + fit.d) / H) * fh;
    setView(clampView({ z, tx: fw / 2 - mx * z, ty: fh / 2 - my * z }));
  };
  const reset = async () => { await uexec("DELETE FROM map_fit WHERE file=$1", m.file); setSaved(null); setDraft(null); };

  return (
    <div className="map">
      {maps!.length > 1 && (
        <div className="row">
          {maps!.map((mm, i) => (
            <button key={mm.file} className={i === floor ? "active-tab" : ""} onClick={() => setFloor(i)}>
              {mm.label !== "Map" ? mm.label : `Map ${i + 1}`}{mm.a == null ? "" : " ✓"}
            </button>
          ))}
        </div>
      )}
      {err && <div className="error">Couldn't download map: {err}</div>}
      <div className="map-frame" ref={frame} onClick={mark}
        style={{ cursor: marks ? "crosshair" : draft ? "move" : view.z > 1 ? "grab" : "default" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          if (draft && !marks) drag.current = { ...toImg(e), fit: draft };      // fitting: drag moves the dots
          else pan.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }; // else: pan the view
        }}
        onPointerMove={(e) => {
          const g = drag.current;
          if (g) { const p = toImg(e); setDraft({ ...g.fit, b: g.fit.b + p.x - g.x, d: g.fit.d + p.y - g.y }); return; }
          const q = pan.current;
          if (q && view.z > 1) {
            const dx = e.clientX - q.x, dy = e.clientY - q.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) q.moved = true;
            setView(clampView({ z: view.z, tx: q.tx + dx, ty: q.ty + dy }));
          }
        }}
        onPointerUp={() => { dragged.current = !!pan.current?.moved; drag.current = null; pan.current = null; }}>
        <div className="map-zoom" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <button title="Zoom in" onClick={() => zoomAt(1.5)}>+</button>
          <button title="Zoom out" onClick={() => zoomAt(1 / 1.5)}>−</button>
          {here && fit && <button title="Zoom to me" onClick={centerOnMe}>⌖</button>}
          {view.z > 1 && <button title="Reset zoom" onClick={() => setView({ z: 1, tx: 0, ty: 0 })}>⟲</button>}
        </div>
        <div ref={box} className="map-content" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.z})` }}>
        {src ? <img src={src} draggable={false} /> : <div className="muted" style={{ width: 512, height: 512 }}>Downloading map…</div>}
        {fit && (
          <svg viewBox={`0 0 ${W} ${H}`} className="map-overlay">
            {draft && cloud.map((p, i) => <circle key={"c" + i} cx={fit.a * p.x + fit.b} cy={fit.c * p.z + fit.d} r={r / 2} className="cloud" />)}
            {points.map((p, i) => (
              <circle key={i} cx={fit.a * p.x + fit.b} cy={fit.c * p.z + fit.d} r={r} className="dot"><title>{p.label} ({p.x.toFixed(0)}, {p.z.toFixed(0)})</title></circle>
            ))}
            {here && <circle cx={fit.a * here.x + fit.b} cy={fit.c * here.z + fit.d} r={r * 1.4} className="me"><title>You</title></circle>}
          </svg>
        )}
        {marks && (
          <svg viewBox={`0 0 ${W} ${H}`} className="map-overlay">
            {marks.map((q, i) => <circle key={i} cx={q.px} cy={q.py} r={r * 1.2} className="mark" />)}
          </svg>
        )}
        </div>
      </div>
      <div className="row muted">
        {marks ? (
          <>{marks.length === 0 ? "Click the spot on the map where you're standing right now." :
              draft ? `${marks.length} points: fit looks good. Mark more to refine, or save.` :
              `${marks.length} point${marks.length > 1 ? "s" : ""}. Walk at least 3 grid squares away and click your new spot.`}
            {live?.zone !== zoneid && <span className="warn"> You're not in this zone.</span>}
            <button onClick={save} disabled={!draft}>Save fit</button><button onClick={() => { setMarks(null); setDraft(null); }}>Cancel</button></>
        ) : draft ? (
          <>Drag to move and scroll to scale until the grey dots (every spawn in the zone) sit on the map.
            <button onClick={save}>Save fit</button><button onClick={() => setDraft(null)}>Cancel</button></>
        ) : (
          <>
            {saved ? "Your fit" : auto ? `Auto-calibrated (${m.n} reference points, ±${Math.round(m.rms!)}px)` : "Not calibrated yet. Dots can't be placed."}
            <button onClick={startFit}>{fit ? "Adjust fit" : "Fit dots"}</button>
            {live?.zone === zoneid && <button onClick={() => { setMarks([]); setDraft(null); }} title="Uses your live in-game position (addon)">Mark my position</button>}
            {saved && <button onClick={reset}>{auto ? "Back to auto" : "Clear fit"}</button>}
          </>
        )}
        <a href={`https://www.bg-wiki.com/ffxi/File:${encodeURIComponent(m.file)}`} target="_blank">map: bg-wiki</a>
      </div>
    </div>
  );
}

// No map for this zone at all: auto-fit scatter so you still see the layout (north up, east right).
function Scatter({ points }: { points: Pt[] }) {
  if (!points.length) return null;
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const span = Math.max(x1 - x0, z1 - z0, 50), pad = span * 0.08;
  return (
    <div className="map">
      <svg viewBox={`${x0 - pad} ${-z1 - pad} ${span + 2 * pad} ${span + 2 * pad}`} className="scatter">
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={-p.z} r={span / 120} className="dot"><title>{p.label} ({p.x.toFixed(0)}, {p.z.toFixed(0)})</title></circle>
        ))}
      </svg>
      <div className="muted">bg-wiki has no map for this zone.</div>
    </div>
  );
}
