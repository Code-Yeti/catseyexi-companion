import { useEffect, useState } from "react";
import { getKv, setKv } from "./db";

// User preferences, one JSON blob in user.db kv. Components share it through usePrefs(); a window event syncs them.
export type Corner = "top-right" | "top-left" | "bottom-right" | "bottom-left";
export type Prefs = { cardCorner: Corner; cardScale: number; soundLearnable: boolean; soundLearned: boolean };
const DEFAULTS: Prefs = { cardCorner: "top-right", cardScale: 1, soundLearnable: true, soundLearned: true };

let cache: Prefs | undefined;
const load = async () => (cache ??= { ...DEFAULTS, ...JSON.parse((await getKv("prefs")) ?? "{}") });

export function usePrefs(): [Prefs, (p: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(cache ?? DEFAULTS);
  useEffect(() => {
    load().then(setPrefs);
    const on = () => setPrefs(cache!);
    window.addEventListener("prefs", on);
    return () => window.removeEventListener("prefs", on);
  }, []);
  const update = (p: Partial<Prefs>) => {
    cache = { ...(cache ?? DEFAULTS), ...p };
    setKv("prefs", JSON.stringify(cache));
    window.dispatchEvent(new Event("prefs"));
  };
  return [prefs, update];
}

// Synthesized chimes (no audio files to ship). "learnable" = two quick high notes, "learned" = a rising three-note arpeggio.
let ctx: AudioContext | undefined;
export function chime(kind: "learnable" | "learned") {
  ctx ??= new AudioContext(); // autoplay allowed by --autoplay-policy in tauri.conf.json (chimes fire without a click)
  ctx.resume();
  const notes = kind === "learnable" ? [988, 988] : [659, 831, 988];
  notes.forEach((f, i) => {
    const t = ctx!.currentTime + i * 0.13;
    const o = ctx!.createOscillator(), g = ctx!.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(ctx!.destination);
    o.start(t);
    o.stop(t + 0.4);
  });
}
