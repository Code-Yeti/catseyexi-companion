// node scripts/test-traits.ts — checks the BLU trait solver.
import assert from "node:assert/strict";
import { solveTrait } from "../src/ffxi.ts";

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
assert.equal(expGain(snap({}), snap({ cur: 400 })), 0);                                  // death: EXP lost
assert.equal(expGain(snap({ limit: 9800, merits: 3 }), snap({ limit: 200, merits: 4 })), 400); // merit rollover
assert.equal(expGain(snap({ limit: 500, merits: 4 }), snap({ limit: 500, merits: 2 })), 0);     // merits spent
assert.equal(expGain(snap({}), snap({ job: 1 })), null);
console.log("exp gain ok");
