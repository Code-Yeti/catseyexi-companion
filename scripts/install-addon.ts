// Copies addon/catseyecompanion into VanaCore's Ashita addons folder.
// Usage: npm run install-addon   (override the client folder with VANACORE_DIR=...)
import { cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vanacore = process.env.VANACORE_DIR ?? "D:/catseyexi/catseyexi-client/Vanacore";
const dest = join(vanacore, "addons", "ashita", "catseyecompanion");
if (!existsSync(join(vanacore, "addons", "ashita"))) {
  console.error(`No Ashita addons folder under ${vanacore}. Set VANACORE_DIR to your VanaCore folder.`);
  process.exit(1);
}
cpSync(join(root, "addon", "catseyecompanion"), dest, { recursive: true });
console.log(`Installed to ${dest}\nIn game: /addon load catseyecompanion ashita   (or add it on the VanaCore launcher's Addons page)`);
