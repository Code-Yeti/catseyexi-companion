// node scripts/test-traits.ts — checks the BLU trait solver.
import assert from "node:assert/strict";
import { solveTrait, unlockLevel } from "../src/ffxi.ts";

const sp = (name: string, trait_weight: number, set_points: number) => ({ name, trait_weight, set_points });
const cost = (s: { set_points: number }) => s.set_points;
const names = (r: { name: string }[] | null) => r?.map((s) => s.name).sort();

// Auto Refresh needs 8: cheapest combo, not the greedy "biggest weight first" pick.
const refresh = [sp("Stinking Gas", 1, 2), sp("Self-Destruct", 2, 3), sp("Frightful Roar", 2, 3), sp("Cold Wave", 1, 1),
  sp("Light of Penance", 2, 5), sp("Voracious Trunk", 3, 4), sp("Actinic Burst", 4, 4), sp("Plasma Charge", 4, 5)];
const r = solveTrait(refresh, 8, cost)!;
assert.equal(r.reduce((a, s) => a + s.trait_weight, 0) >= 8, true);
assert.equal(r.reduce((a, s) => a + s.set_points, 0), 9); // Actinic Burst (4/4) + Plasma Charge (4/5)
assert.deepEqual(names(r), ["Actinic Burst", "Plasma Charge"]);

assert.equal(solveTrait([sp("A", 1, 1)], 2, cost), null); // unreachable
assert.equal(unlockLevel([{ level: 40, trait_weight: 4 }, { level: 10, trait_weight: 4 }, { level: 60, trait_weight: 4 }], 8), 40);
assert.equal(unlockLevel([{ level: 10, trait_weight: 4 }], 8), null);
assert.deepEqual(names(solveTrait([sp("A", 1, 5), sp("B", 1, 1)], 1, cost)), ["B"]);
console.log("trait solver ok");

// fitMap: recovers px = s*x + b, py = -s*z + d and drops a bad pair.
import { fitMap } from "../src/ffxi.ts";
const truth = (x: number, z: number) => ({ x, z, px: 0.2 * x + 256, py: -0.2 * z + 256 });
const fit = fitMap([truth(0, 0), truth(500, 300), truth(-400, 100), truth(200, -600), { x: 100, z: 100, px: 500, py: 20 }])!;
assert.ok(Math.abs(fit.a - 0.2) < 1e-9 && Math.abs(fit.c + 0.2) < 1e-9 && fit.n === 4);
assert.equal(fitMap([truth(0, 0), truth(1, 1)]), null); // too little spread to trust
console.log("map fit ok");

// activeTraits: highest reached tier per category.
import { activeTraits } from "../src/ffxi.ts";
const tiers = [{ category: 14, tier: 1, points: 8 }, { category: 24, tier: 0, points: 2 }, { category: 24, tier: 1, points: 4 }];
const set = [{ trait_category: 24, trait_weight: 1 }, { trait_category: 24, trait_weight: 2 }, { trait_category: 14, trait_weight: 4 }];
assert.deepEqual(activeTraits(set, tiers).map((t) => `${t.category}:${t.tier}`), ["24:0"]); // 3 pts in 24, 4 of 8 in 14
console.log("active traits ok");

// decodeLogs: bit layout of quest (port 0x90 = San d'Oria complete, 0x50 = offered) and mission logs.
import { decodeLogs } from "../src/ffxi.ts";
const hex = (set: number[]) => { const b = new Array(32).fill(0); for (const i of set) b[i >> 3] |= 1 << (i & 7); return b.map((x) => x.toString(16).padStart(2, "0")).join(""); };
const d = decodeLogs({ [String(0x90)]: hex([0, 75]), [String(0x50)]: hex([3]), [String(0xd0)]: hex([0, 64 + 2]),
  [String(0xffff)]: "00000000" + "05000000" + "00".repeat(24) });
assert.deepEqual(d.quests.map((q) => `${q.log}:${q.id}:${q.done ? "done" : "active"}`), ["0:0:done", "0:3:active", "0:75:done"]);
assert.deepEqual(d.missionsDone, [{ log: 0, id: 0 }, { log: 1, id: 2 }]);
assert.equal(d.current?.nationMission, 5);
console.log("quest log decode ok");

import { expGain, type ExpSnap } from "../src/ffxi.ts";
const snap = (o: Partial<ExpSnap>): ExpSnap => ({ job: 16, lvl: 66, cur: 1000, need: 20000, limit: 0, merits: 0, ...o });
assert.equal(expGain(snap({}), snap({ cur: 1300 })), 300);
assert.equal(expGain(snap({ cur: 19900 }), snap({ lvl: 67, cur: 150, need: 21000 })), 250); // level-up
const zoning = snap({ cur: 0, need: 0, limit: 0, merits: 0 });
assert.equal(expGain(snap({ cur: 1300 }), zoning), 0);
assert.equal(expGain(zoning, snap({ cur: 1300 })), 0); // the reload after zoning is not a gain
assert.equal(expGain(snap({}), snap({ cur: 400 })), 0);                                  // death: EXP lost
assert.equal(expGain(snap({ limit: 9800, merits: 3 }), snap({ limit: 200, merits: 4 })), 400); // merit rollover
assert.equal(expGain(snap({ limit: 500, merits: 4 }), snap({ limit: 500, merits: 2 })), 0);     // merits spent
assert.equal(expGain(snap({}), snap({ job: 1 })), null);
console.log("exp gain ok");

import { skillchain, SC_NAMES } from "../src/ffxi.ts";
const sc = (a: number[], b: number[]) => { const r = skillchain(a, b); return r === null ? null : SC_NAMES[r]; };
assert.equal(sc([4, 8], [12, 4]), null);             // Vorpal Blade > Savage Blade: nothing
assert.equal(sc([3, 6], [4, 8]), "Fusion");         // Red Lotus Blade > Vorpal Blade: Fusion beats Scission
assert.equal(sc([6], [2]), "Gravitation");
assert.equal(sc([12], [11]), "Light");
assert.equal(sc([2], [6]), "Detonation");
assert.equal(sc([13], [13]), "Light");
console.log("skillchain ok");

import { wsPoints } from "../src/ffxi.ts";
assert.deepEqual([wsPoints(0), wsPoints(299), wsPoints(293), wsPoints(288)], [5, 7, 9, 11]); // none, Scission, Fusion, Light
console.log("ws points ok");

import { nextTally, nextDaily, dhm } from "../src/ffxi.ts";
const at = (s: string) => new Date(s).getTime();
assert.equal(new Date(nextTally(at("2026-10-25T12:00:00Z"))).toISOString(), "2026-10-25T15:00:00.000Z"); // Sunday morning: today
assert.equal(new Date(nextTally(at("2026-10-25T15:00:00Z"))).toISOString(), "2026-11-01T15:00:00.000Z"); // at the tally: next week
assert.equal(new Date(nextTally(at("2026-10-28T09:30:00Z"))).toISOString(), "2026-11-01T15:00:00.000Z"); // Wednesday
assert.equal(dhm(((2 * 24 + 4) * 60 + 13) * 60000 + 59000), "2d 4h 13m");
assert.equal(dhm((5 * 60 + 2) * 60000), "5h 2m");
assert.equal(new Date(nextDaily(at("2026-10-28T09:30:00Z"))).toISOString(), "2026-10-28T15:00:00.000Z");
assert.equal(new Date(nextDaily(at("2026-10-28T15:00:00Z"))).toISOString(), "2026-10-29T15:00:00.000Z");
console.log("tally ok");

import { parseVentures, parseWsPoints } from "../src/ffxi.ts";
const vl = ["Arcadea : !ventures", "=== Today's Goblin Ventures ===",
  "Pool A: (10-19) Buburimu Peninsula @28%, (20-29) Korroloka Tunnel @87%, (30-39) Yhoator Jungle @25%",
  "(40-49) Toraimarai Canal @23%, (50-59) Kuftal Tunnel @19%, (60-69) The Boyahda Tree @37%",
  "Pool B: (10-19) East Ronfaure [S] @72%, (20-29) Bhaflau Thickets @23%, (30-39) Vunkerl Inlet [S] @68%",
  "(40-49) East Ronfaure [S] @9%, (50-59) Aydeewa Subterrane, (60-69) Alzadaal Undersea Ruins @6%",
  "HVNM: Sauromugue Champaign (Swiftsting) @65.0%", "Kupipi misses the Steelshell."].map((text) => ({ text, time: 1 }));
const v = parseVentures(vl)!;
assert.equal(v.tiers.length, 12);
assert.deepEqual(v.tiers[5], { pool: "A", lo: 60, hi: 69, zone: "The Boyahda Tree", pct: 37 });
assert.deepEqual(v.tiers[10], { pool: "B", lo: 50, hi: 59, zone: "Aydeewa Subterrane", pct: null });
assert.deepEqual(v.tiers[6], { pool: "B", lo: 10, hi: 19, zone: "East Ronfaure [S]", pct: 72 });
assert.deepEqual(v.hvnm, { zone: "Sauromugue Champaign", nm: "Swiftsting", pct: 65 });
assert.deepEqual(parseWsPoints("----== SystemMessage ==----The weapon in Arcadea's main slot has 120 WS points."), { slot: 0, points: 120 });
console.log("chat parsers ok");

import { pretty, nameKey, setDisplayNames } from "../src/ffxi.ts";
setDisplayNames([{ key: nameKey("Om'aern"), name: "Om'aern" }]);
assert.equal(pretty("Omaern"), "Om'aern");
assert.equal(pretty("Omaern_BST"), "Om'aern BST");
assert.equal(pretty("mad_sheep"), "Mad Sheep");
assert.equal(nameKey("Escha - Zi'Tah"), nameKey("Escha_ZiTah"));
console.log("display names ok");

import { parseTraining } from "../src/ffxi.ts";
const tl = (texts: string[]) => texts.map((text, i) => ({ text, time: 100 + i }));
const tr = parseTraining(tl(["You defeated a designated target. (Progress: 2/4)",
  "Records of Eminence: Vanquish Multiple Enemies I.", "Progress: 78/200.",
  "Records of Eminence: Conflict: Boyahda Tree.", "Progress: 9/10.",
  "Records of Eminence: Physical Damage Kills.Progress: 9/20.", "Limit chain #3!",
  "Records of Eminence: Conflict: Boyahda Tree.", "Progress: 10/10."]));
assert.deepEqual(tr.regime, { targets: [{ name: "Designated target", done: 2, need: 4, time: 100 }], complete: false, reward: undefined });
assert.deepEqual(tr.roe.map((r) => `${r.name} ${r.done}/${r.need}`), ["Conflict: Boyahda Tree 10/10", "Physical Damage Kills 9/20", "Vanquish Multiple Enemies I 78/200"]);
assert.equal(tr.other.length, 0);
assert.equal(parseTraining(tl(["You defeated a designated target. (Progress: 4/4)", "You have completed the training regime."])).regime?.complete, true);
const kills = [{ text: "You defeated a designated target. (Progress: 1/4)", time: 1, mob: "Steelshell" },
  { text: "You defeated a designated target. (Progress: 1/6)", time: 2, mob: "Boyahda Sapling" },
  { text: "You defeated a designated target. (Progress: 2/4)", time: 3, mob: "Steelshell" }];
assert.deepEqual(parseTraining(kills).regime?.targets.map((c) => `${c.name} ${c.done}/${c.need}`), ["Steelshell 2/4", "Boyahda Sapling 1/6"]);
const done = [...kills, { text: "You have successfully completed the training regime.", time: 4 }, { text: "Your current training regime will begin anew!", time: 4 }];
assert.deepEqual(parseTraining(done).regime?.targets.map((c) => `${c.name} ${c.done}/${c.need}`), ["Steelshell 0/4", "Boyahda Sapling 0/6"]); // bars stay, at 0
assert.equal(parseTraining(done).regime?.complete, true);
const again = parseTraining([...done, { ...kills[0], time: 5 }]).regime!;
assert.deepEqual([again.targets.map((c) => `${c.name} ${c.done}`), again.complete], [["Steelshell 1", "Boyahda Sapling 0"], false]);
assert.deepEqual(parseTraining(tl(["Records of Eminence: Conflict: Boyahda Tree.", "Progress: 9/10.",
  "You have completed the following Records of Eminence objective: Conflict: Boyahda Tree."])).roe.map((r) => `${r.done}/${r.need}`), ["10/10"]);
// Rewards: the EXP line right after a completion, replaced by the next completion's.
const rw = (texts: string[]) => parseTraining(tl(texts));
const paid = rw(["You defeated a designated target. (Progress: 4/4)", "You have successfully completed the training regime.",
  "Arcadea gains 600 experience points.", "Arcadea gains 150 experience points.",
  "You have completed the following Records of Eminence objective: Conflict: Boyahda Tree.", "Arcadea gains 1,000 limit points."]);
assert.equal(paid.regime?.reward, "600 EXP");
assert.equal(paid.roe[0].reward, "1,000 limit points");
assert.equal(rw(["You defeated a designated target. (Progress: 4/4)", "You have successfully completed the training regime.", "Arcadea gains 600 experience points.",
  "You have successfully completed the training regime.", "Arcadea gains 720 experience points."]).regime?.reward, "720 EXP");
console.log("training ok");

import { timedRoe, nextTimedRoe } from "../src/ffxi.ts";
// 2026-10-27 is a Tuesday. 06:00Z = 15:00 JST Tuesday: block 12-16 = Gain Experience (4013), 15:00Z = Wed 00:00 JST.
assert.deepEqual(timedRoe(at("2026-10-27T06:00:00Z")), { name: "Gain Experience", start: at("2026-10-27T03:00:00Z"), end: at("2026-10-27T07:00:00Z") });
assert.equal(timedRoe(at("2026-10-27T15:00:00Z")).name, "Vanquish Undead"); // Wednesday 00-04 JST
assert.equal(timedRoe(at("2026-10-25T14:59:00Z")).name, "Gain Experience"); // Sunday 20-24 JST
assert.equal(nextTimedRoe("Gain Experience", at("2026-10-27T08:00:00Z")), at("2026-10-28T19:00:00Z")); // Thursday 04-08 JST
console.log("timed roe ok");
