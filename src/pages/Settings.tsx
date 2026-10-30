import { useEffect, useState } from "react";
import { q, uexec } from "../db";
import { downloadedCount, localMap, type ZoneMapRow } from "../maps";
import { useApp } from "../ctx";
import { usePrefs, chime, type Corner } from "../prefs";

export default function Settings() {
  const [maps, setMaps] = useState<ZoneMapRow[]>([]);
  const [have, setHave] = useState(0);
  const [progress, setProgress] = useState<string>();
  const { live, char } = useApp();
  const [prefs, setPrefs] = usePrefs();
  // Axis sanity check: the addon's position should match catseyexi.com's (same zone, within a few yalms of movement).
  const axisOk = live && char && live.zone === char.pos_zone
    ? Math.hypot(live.pos.x - char.pos_x, live.pos.z - char.pos_z) < 150 : undefined;

  useEffect(() => {
    q<ZoneMapRow>("SELECT * FROM zone_maps").then(setMaps);
    downloadedCount().then(setHave);
  }, []);

  const downloadAll = async () => {
    let done = 0, failed = 0;
    for (const m of maps) {
      try { await localMap(m); } catch { failed++; }
      setProgress(`${++done}/${maps.length}${failed ? ` (${failed} failed)` : ""}`);
    }
    setHave(await downloadedCount());
  };

  return (
    <div>
      <h1>Settings</h1>
      <h2>Game addon</h2>
      <p className="muted">
        The optional <b>catseyecompanion</b> Ashita addon reads what your game client already knows: position, target, learned and set
        blue magic, every storage bag, and your quest log. It writes it to a file for this app. It only reads; it never sends anything to the
        server. That puts it in CatseyeXI's "Information" tier, which is allowed by default.
      </p>
      {live ? (
        <div className="good">Connected: {live.char}, {Math.round(Date.now() / 1000 - live.ts)}s ago · {live.bluKnown?.length ?? 0} blue spells known
          {axisOk === false && <span className="warn"> · Position doesn't match catseyexi.com, so map dots may be off.</span>}</div>
      ) : (
        <div className="muted">
          Not connected. To install, run <code>npm run install-addon</code> (copies it into VanaCore's Ashita addons), then in game type{" "}
          <code>/addon load catseyecompanion ashita</code>, or add it on the VanaCore launcher's Addons page so it loads every time.
        </div>
      )}

      <h2>Target card</h2>
      <p className="muted">The card that shows your in-game target (needs the addon).</p>
      <div className="row">
        <span>Position</span>
        {(["top-left", "top-right", "bottom-left", "bottom-right"] as Corner[]).map((c) => (
          <button key={c} className={prefs.cardCorner === c ? "active-tab" : ""} onClick={() => setPrefs({ cardCorner: c })}>
            {c.replace("-", " ")}
          </button>
        ))}
      </div>
      <div className="row">
        <span>Size</span>
        <input type="range" min={1} max={2} step={0.05} value={prefs.cardScale} onChange={(e) => setPrefs({ cardScale: Number(e.target.value) })} />
        <span className="muted">{Math.round(prefs.cardScale * 100)}%</span>
      </div>

      <h2>Sounds</h2>
      <div className="row">
        <label><input type="checkbox" checked={prefs.soundLearnable} onChange={(e) => setPrefs({ soundLearnable: e.target.checked })} />
          {" "}When your target uses a move that teaches a spell you're missing</label>
        <button onClick={() => chime("learnable")}>Test</button>
      </div>
      <div className="row">
        <label><input type="checkbox" checked={prefs.soundLearned} onChange={(e) => setPrefs({ soundLearned: e.target.checked })} />
          {" "}When you learn a spell</label>
        <button onClick={() => chime("learned")}>Test</button>
      </div>

      <h2>Macros and scripts</h2>
      <p className="muted">Folders the Macros page edits. FFXI keeps macros in its USER folder, one subfolder per character.</p>
      <div className="row">
        <span>Ashita scripts</span>
        <input style={{ flex: 1 }} value={prefs.scriptsDir} onChange={(e) => setPrefs({ scriptsDir: e.target.value })} />
      </div>
      <div className="row">
        <span>FFXI USER folder</span>
        <input style={{ flex: 1 }} value={prefs.userDir} onChange={(e) => setPrefs({ userDir: e.target.value })} />
      </div>

      <h2>Zone maps</h2>
      <p className="muted">
        Maps come from bg-wiki: Square Enix's in-game maps, annotated by the community. Each map downloads to this PC the first
        time you open it. {have} of {maps.length} are downloaded. To use everything offline, download them all at once.
      </p>
      <div className="row">
        <button onClick={downloadAll} disabled={!!progress && !progress.startsWith(`${maps.length}/`)}>Download all maps</button>
        {progress && <span className="muted">{progress}</span>}
      </div>

      <h2>Cached data</h2>
      <p className="muted">CatseyeXI API responses (character, items, mob checks) are cached for offline use.</p>
      <button onClick={async () => { await uexec("DELETE FROM api_cache"); alert("Cache cleared"); }}>Clear cache</button>

      <h2>Data sources</h2>
      <ul className="muted">
        <li><b>CatseyeXI</b> (catseyexi.com/api): your character, inventory, item stats, mob check. This is the source of truth.</li>
        <li><b>bg-wiki Category:CatsEyeXI</b>: custom Blue Magic, job changes, custom quests. Built into the app; rebuild with <code>npm run build-db</code>.</li>
        <li><b>bg-wiki zone pages</b>: zone maps, and the NPC/zone-line positions used to calibrate them.</li>
        <li><b>LandSandBoat</b>: spawn points, drops, mob skills, BLU traits. CatseyeXI forks LSB, but its drops and spawns can differ.</li>
      </ul>
    </div>
  );
}
