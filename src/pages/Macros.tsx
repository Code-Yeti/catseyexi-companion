import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { exists, readDir, readFile, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { usePrefs } from "../prefs";
import { useApp } from "../ctx";
import { ask, confirmBox, promptBox } from "../components/Dialog";
import type { Live } from "../live";
import { decodeMacros, encodeMacros, decodeBookTitles, encodeBookTitles, type Macro } from "../ffxi";

// Editing files the game also writes: keep a .bak of whatever was there before each save.
async function save(path: string, data: Uint8Array) {
  if (await exists(path)) await writeFile(path + ".bak", await readFile(path));
  await writeFile(path, data);
}

// Lines worth suggesting, from the addon: everything worn, and what you can cast or use right now.
const SLOTS = ["main", "sub", "range", "ammo", "head", "neck", "ear1", "ear2", "body", "hands", "ring1", "ring2", "back", "waist", "legs", "feet"];
const equipLines = (l: Live | null) => SLOTS.filter((s) => l?.equip?.[s]).map((s) => `/equip ${s} "${l!.equip![s]}"`);
const suggestions = (l: Live | null) => [
  ...(l?.known?.spells ?? []).map((s) => `/ma "${s}" <t>`),
  ...(l?.known?.abilities ?? []).map((s) => `/ja "${s}" <me>`),
  ...(l?.known?.ws ?? []).map((s) => `/ws "${s}" <t>`),
  ...equipLines(l),
];

export default function Macros() {
  const [prefs] = usePrefs();
  const { live } = useApp();
  const [tab, setTab] = useState<"macros" | "scripts">("macros");
  return (
    <div>
      <h1>Macros</h1>
      <div className="row">
        <button className={tab === "macros" ? "active-tab" : ""} onClick={() => setTab("macros")}>In-game macros</button>
        <button className={tab === "scripts" ? "active-tab" : ""} onClick={() => setTab("scripts")}>Ashita scripts</button>
        <span className="muted">Folders are set in Settings.{!live?.known && " Start the game addon for spell, ability and gear suggestions."}</span>
      </div>
      <datalist id="cmd-suggest">{suggestions(live).map((s) => <option key={s} value={s} />)}</datalist>
      {tab === "macros" ? <GameMacros key={prefs.userDir} dir={prefs.userDir} /> : <Scripts key={prefs.scriptsDir} dir={prefs.scriptsDir} live={live} />}
    </div>
  );
}

function useAllowed(dir: string) {
  const [err, setErr] = useState<string>();
  const [ok, setOk] = useState(false);
  useEffect(() => { invoke("allow_dir", { path: dir }).then(() => setOk(true), (e) => setErr(String(e))); }, [dir]);
  return [ok, err] as const;
}

function GameMacros({ dir }: { dir: string }) {
  const [ok, err] = useAllowed(dir);
  const [chars, setChars] = useState<string[]>([]);
  const [char, setChar] = useState<string>();
  const [titles, setTitles] = useState<string[]>([]);
  const [book, setBook] = useState(0);
  const [set, setSet] = useState(0);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [orig, setOrig] = useState<Uint8Array | null>(null);
  const [sel, setSel] = useState(0);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string>();
  const [dirty, setDirty] = useState(false);

  // Character folders are the ones holding mcr.ttl (named by content id, so there's no name to show).
  useEffect(() => {
    if (!ok) return;
    readDir(dir).then(async (es) => {
      const cs = [];
      for (const e of es) if (e.isDirectory && (await exists(await join(dir, e.name, "mcr.ttl")))) cs.push(e.name);
      setChars(cs);
      setChar(cs[0]);
    }, (e) => setMsg(String(e)));
  }, [ok]);

  const ttl = async (b: number) => join(dir, char!, b < 20 ? "mcr.ttl" : "mcr_2.ttl");
  const setPath = async () => join(dir, char!, `mcr${book * 10 + set || ""}.dat`);

  useEffect(() => {
    if (!char) return;
    (async () => {
      const t = await Promise.all([0, 20].map(async (b) => (await exists(await ttl(b))) ? decodeBookTitles(await readFile(await ttl(b))) : []));
      setTitles(t.flat());
    })().catch((e) => setMsg(String(e)));
  }, [char]);
  useEffect(() => setName(titles[book] ?? ""), [titles, book]);

  useEffect(() => {
    if (!char) return;
    (async () => {
      const p = await setPath();
      const f = (await exists(p)) ? await readFile(p) : null;
      setOrig(f);
      setMacros(decodeMacros(f));
      setDirty(false);
      setMsg(undefined);
    })().catch((e) => setMsg(String(e)));
  }, [char, book, set]);

  const pick = (fn: () => void) => async () => { if (!dirty || (await confirmBox("Discard unsaved changes to this set?", "Discard"))) fn(); };
  const edit = (m: Partial<Macro>) => { setMacros((ms) => ms.map((x, i) => (i === sel ? { ...x, ...m } : x))); setDirty(true); };

  const saveSet = async () => {
    try {
      const data = encodeMacros(macros, orig);
      await save(await setPath(), data);
      setOrig(data);
      setDirty(false);
      setMsg("Saved.");
    } catch (e) { setMsg(String(e)); }
  };
  const rename = async () => {
    try {
      const p = await ttl(book), base = await readFile(p);
      const local = decodeBookTitles(base);
      local[book % 20] = name;
      await save(p, encodeBookTitles(local, base));
      setTitles((t) => t.map((x, i) => (i === book ? name : x)));
      setMsg("Book renamed.");
    } catch (e) { setMsg(String(e)); }
  };

  if (err) return <div className="warn">{err}</div>;
  if (!char) return <div className="muted">{ok ? `No character macro folders (with mcr.ttl) in ${dir}.` : "Loading…"}</div>;
  const m = macros[sel];

  return (
    <div>
      <p className="muted">
        The game loads macros at login and writes its own copy when you change them in game, so edit while logged out (or relog after saving).
        Each save keeps the previous file as <code>.bak</code>. Auto-translate phrases show as <code>{"{AT:…}"}</code>; leave them as they are.
      </p>
      <div className="row">
        {chars.length > 1 && (
          <select value={char} onChange={(e) => setChar(e.target.value)}>{chars.map((c) => <option key={c}>{c}</option>)}</select>
        )}
        <span>Book</span>
        <select value={book} onChange={(e) => { const b = Number(e.target.value); pick(() => setBook(b))(); }}>
          {titles.map((t, i) => <option key={i} value={i}>{i + 1}. {t}</option>)}
        </select>
        <input value={name} maxLength={15} onChange={(e) => setName(e.target.value)} />
        <button onClick={rename} disabled={name === titles[book]}>Rename book</button>
      </div>
      <div className="row">
        <span>Set</span>
        {Array.from({ length: 10 }, (_, i) => (
          <button key={i} className={set === i ? "active-tab" : ""} onClick={pick(() => setSet(i))}>{i + 1}</button>
        ))}
      </div>
      {(["Ctrl", "Alt"] as const).map((mod, r) => (
        <div className="row" key={mod}>
          <span style={{ width: 32 }}>{mod}</span>
          {macros.slice(r * 10, r * 10 + 10).map((x, i) => (
            <button key={i} style={{ width: 84 }} className={sel === r * 10 + i ? "active-tab" : ""} onClick={() => setSel(r * 10 + i)}>
              <span className="muted">{(i + 1) % 10}</span> {x.title || " "}
            </button>
          ))}
        </div>
      ))}
      {m && (
        <div className="card">
          <div className="row">
            <span>{sel < 10 ? "Ctrl" : "Alt"}+{(sel % 10 + 1) % 10} title</span>
            <input value={m.title} maxLength={8} onChange={(e) => edit({ title: e.target.value })} />
          </div>
          {m.lines.map((l, i) => (
            <input key={i} list="cmd-suggest" style={{ display: "block", width: "100%", margin: "4px 0", fontFamily: "monospace" }} value={l}
              onChange={(e) => edit({ lines: m.lines.map((x, j) => (j === i ? e.target.value : x)) })} />
          ))}
        </div>
      )}
      <div className="row">
        <button onClick={saveSet} disabled={!dirty}>Save set</button>
        {msg && <span className={msg.startsWith("Saved") || msg.startsWith("Book") ? "good" : "warn"}>{msg}</span>}
      </div>
    </div>
  );
}

function Scripts({ dir, live }: { dir: string; live: Live | null }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [line, setLine] = useState("");
  const [ok, err] = useAllowed(dir);
  const [files, setFiles] = useState<string[]>([]);
  const [file, setFile] = useState<string>();
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [msg, setMsg] = useState<string>();

  const list = () => readDir(dir).then((es) => setFiles(es.filter((e) => e.isFile && /\.txt$/i.test(e.name)).map((e) => e.name).sort()), (e) => setMsg(String(e)));
  useEffect(() => { if (ok) list(); }, [ok]);

  const discardOk = async () => text === saved || (await confirmBox(`Discard unsaved changes to ${file}?`, "Discard"));
  const open = async (f: string) => {
    if (!(await discardOk())) return;
    const t = await readTextFile(await join(dir, f));
    setFile(f); setText(t); setSaved(t); setMsg(undefined);
  };
  const saveFile = async () => {
    try {
      await writeTextFile(await join(dir, file!), text);
      setSaved(text);
      setMsg("Saved.");
      list();
    } catch (e) { setMsg(String(e)); }
  };
  const create = async (name = "", body = "") => {
    if (!(await discardOk())) return;
    const n = await promptBox("New script name", name);
    if (!n) return;
    const f = /\.txt$/i.test(n) ? n : `${n}.txt`;
    if (files.includes(f) && !(await confirmBox(`${f} already exists. Replace its text?\nNothing is written until you Save.`, "Replace"))) return;
    setFile(f); setText(body); setSaved("\0"); setMsg(undefined); // unsaved until Save
  };
  // Puts a line at the cursor (or the end), on its own line.
  const insert = () => {
    if (!line) return;
    const at = area.current?.selectionStart ?? text.length;
    const before = text.slice(0, at), after = text.slice(at);
    setText(`${before}${before && !before.endsWith("\n") ? "\n" : ""}${line}\n${after.replace(/^\n/, "")}`);
    setLine("");
  };

  if (err) return <div className="warn">{err}</div>;
  return (
    <div>
      <p className="muted">Run a script in game with <code>/exec name</code> (without .txt).</p>
      <div className="row">
        {files.map((f) => <button key={f} className={f === file ? "active-tab" : ""} onClick={() => open(f)}>{f}</button>)}
        <button onClick={() => create()}>+ New</button>
        <button onClick={async () => {
          const gear = equipLines(live).join("\n") + "\n";
          if (!file) return create("gear", gear);
          const r = await ask(`Put what you're wearing into ${file}, or into a new script?\nNothing is written until you Save.`, [`Overwrite ${file}`, "New script"]);
          if (r?.button === "New script") create("gear", gear);
          else if (r) setText(gear);
        }} disabled={!live?.equip}
          title={live?.equip ? "New script that equips what you're wearing" : "Needs the game addon running"}>Equip Wearing</button>
      </div>
      {file && (
        <>
          <div className="row">
            <input list="cmd-suggest" style={{ flex: 1, fontFamily: "monospace" }} placeholder="Type to search spells, abilities, weapon skills, gear…"
              value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => e.key === "Enter" && insert()} />
            <button onClick={insert} disabled={!line}>Insert line</button>
          </div>
          <textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
            style={{ width: "100%", height: 360, fontFamily: "monospace", background: "#0e1015", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 6, padding: 8 }} />
          <div className="row">
            <button onClick={saveFile} disabled={text === saved}>Save {file}</button>
            {msg && <span className={msg === "Saved." ? "good" : "warn"}>{msg}</span>}
          </div>
        </>
      )}
    </div>
  );
}
