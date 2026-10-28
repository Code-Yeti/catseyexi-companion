# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Tauri v2 + React + TypeScript desktop companion for the CatseyeXI FFXI private server: character sync, Blue Magic finder with spawn maps, gear planner, and progress checklists. It runs standalone and never reads game memory or touches the client.

## Commands

- `npm run build-db`: regenerate `src-tauri/resources/reference.db` and `data/diff-report.md`. Runs `scripts/build-db.ts` directly on Node 24, using built-in TS stripping and `node:sqlite`, with no extra deps. It ends with assert self-checks, which serve as the data tests. Needs the LSB checkout at `../FFXI-lsb` (or `LSB_SQL=<path to sql/>`) and network access to bg-wiki.
- `npm run tauri dev`: run the app. Rust lives in `~/.cargo/bin`; add it to PATH if the shell doesn't have it.
- `npm run tauri build -- --no-bundle`: build just `src-tauri/target/release/ffxi-companion.exe` (the normal dev loop). `npm run tauri build` also makes the MSI under `src-tauri/target/release/bundle/msi/`; that is slow, so only for releases.
- `npx tsc --noEmit`: typecheck the frontend.
- `node scripts/test-traits.ts`: assert checks for the pure logic in `src/ffxi.ts`: the trait solver, `fitMap`, `activeTraits`, the quest-log decoder `decodeLogs`, and `expGain` (EXP/merit rate tracking).
- Repos: this whole project is **private** at `Code-Yeti/catseyexi-companion` (remote `origin`). The addon alone is **public** at `Code-Yeti/catseyecompanion`, for CatseyeXI staff review. Publish addon changes with `git subtree push --prefix=addon/catseyecompanion https://github.com/Code-Yeti/catseyecompanion.git main`. Never push anything else there. Commits use the noreply email set in this repo's git config.
- `npm run install-addon`: copy `addon/catseyecompanion` into `D:/catseyexi/catseyexi-client/Vanacore/addons/ashita` (override with `VANACORE_DIR`). In game, load it with `/addon load catseyecompanion ashita`. Keep pure logic that needs tests in `ffxi.ts`, which has no imports, so Node can run it without a bundler.
- UI automation: launch with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, then drive the webview over CDP at `http://127.0.0.1:9222/json`.

## Data model: three sources, CatseyeXI wins

1. **catseyexi.com public API**, the source of truth at runtime. See `src/catseye.ts`.
   - Endpoints: `/api/char/{id}`, `/api/char/{id}/inventory`, `/api/item/{id}`, `/api/equipment/search?q=`, `/api/search/mobs?q=`.
   - Every response is cached in `user.db` (`api_cache`). The network is hit only on an explicit Refresh or a cache miss.
   - Don't bulk-crawl it. Diffing ~4.6k mob names at build time was tried and dropped. Mob checks happen per page view instead.
2. **LandSandBoat SQL at commit `c92debd129`**, the last commit before LSB moved spawns to per-zone YAML regions. CatseyeXI forked the SQL era, so ids match the live API.
   - The importer in `build-db.ts` generically parses MySQL dumps: `SET @VAR` (case-insensitive), `0x` hex, and `|` flag expressions.
3. **bg-wiki `Category:CatsEyeXI`** via the MediaWiki API, used for:
   - `cx_blu_spells`, from the Blue Mage table on `CatsEyeXI_Systems/Jobs`
   - `checklist_seed` custom quests, from `CatsEyeXI_Systems/Quests` (they have no LSB quest ids, so no auto-tick). Mission lists are built from LSB `mission_names` instead, with `log`/`mid` so Progress ticks them from the game log: completed bits for nation and Zilart, ids before the current mission for CoP/ToAU/WotG.
   - `cx_pages`
4. `data/overrides.sql`: hand fixes, applied after imports but before `blu_spells` is derived.

## Non-obvious facts

- Spawn zone is `(mobid >> 12) & 4095`. `mob_spawn_points.groupid` joins `mob_groups` on **(groupid, zoneid)**. The `spawns` view does this, and needs the composite index or it becomes a billion-row scan.
- A BLU spell's level is byte 16 of the `spell_list.jobs` hex string: `slice(30,32)`.
- Spell → mob chain: `blu_spell_skills` (mob_skill_id) → `mob_skill_lists` → `mob_pools.skill_list_id` → `spawns`. `blu_sources` is the flattened view.
- CatseyeXI-only spells, which exist in neither LSB `spell_list` nor `blue_spell_list`, get **negative synthetic spellids** that change between builds. That's why user state keys learned spells by **name** (`blu_learned.name`).
- Level cap is 75. Spells above 75 are `available=0` unless the wiki lists them.
- **What counts as CatseyeXI content** is `mob_index.era`, set by `seedCxLevels` in `build-db.ts`. Don't hardcode a zone-id cutoff: CatseyeXI re-levelled some retail post-75 zones (Escha - Zi'Tah's mobs run 50-86 there, versus 107+ in LSB).
  - For each zone id ≥ 256, one CatseyeXI mob search probes it. Zones within reach (≤ 85) get every mob's CatseyeXI level into `cx_pool_levels`; CatseyeXI search ids are LSB pool ids. Currently that's ~90 requests, cached in `data/cx-cache.json` (delete it to refresh).
  - `era` = not a lv ≤ 1 placeholder, in a CatseyeXI zone, and effective level ≤ 85. The Mobs and BLU pages hide everything else behind a toggle.
  - Zones < 256 keep LSB levels.
- BLU traits come from LSB `blue_traits` → `blu_trait_tiers`, with each spell's `trait_category`/`trait_weight` stored on `blu_spells`. A tier is active when the summed weights of set spells in its category reach `points`. JP-only tiers are excluded, since there are no job points at 75. CatseyeXI-only spells have no trait data.
- `mob_index` (built in `build-db.ts`) is one row per mob per zone, backing the sortable Mobs page. It carries aggro/link/true-sight flags from `mob_pools` and the BLU spells each mob teaches.
- Your own character loads from cache instantly, then live, then every 3 min (inventory every 15 min), on the same timer as friends. Background refreshes are `quiet`: no error banner, and the last data is kept on failure. When the BLU level rises between two loads, a popup lists the newly learnable spells. CatseyeXI's API has no learned-spells data, so `blu_learned` stays manual.
- Window size, position and monitor are saved by `tauri-plugin-window-state` (`.window-state.json` in AppData) on a normal close. Close the app gracefully before a rebuild (`CloseMainWindow`), not with a force-kill, or that state is lost.
- Dev builds can't start while the installed app is running, because WebView2 refuses one profile with different debug args. Set `WEBVIEW2_USER_DATA_FOLDER` to a scratch folder for `tauri dev`.
- Friends are stored as char ids in `user.db.friends` and polled in `App.tsx` every 3 min, sequentially. Keep the rate low: it hits catseyexi.com once per friend. An in-app popup (bottom-right, `toast` in `App.tsx`, plus a taskbar flash via `requestUserAttention`) fires only on an offline→online change between two *live* checks, never on startup. Windows system toasts were tried and dropped: unregistered apps show as "Windows PowerShell".
- Item icons are hotlinked from `static.ffxiah.com/images/icon/{itemid}.png` (`ItemIcon`), as catseyexi.com does. Not bundled.
- Target card matches the target by server id: client id = LSB `mob_spawn_points.mobid`, zone = `(id >> 12) & 4095`, then `mob_index` by mobname + zone (not poolid: `mob_index` keeps one pool per mob and zone, and Om'aern alone has 13). Name match is only the fallback.
- **Apostrophes:** LSB and CatseyeXI's API drop them ("Omaern", "AlTaieu"). `display_names` (build-db `seedDisplayNames`, from bg-wiki Bestiary and Areas titles) restores them: the `zones` view and `mob_index.name` use it, and App loads it into `pretty()`. Match game or typed names with `nameKey()` (letters and digits only); `like()` strips apostrophes.
- Skillchains: `sc_skills` (build-db `seedSkillchainSkills`) holds Lv75-era weapon skills (skill <= 276, relic, mythic unlock ids 15-34) and blue spells with skillchain properties, as LSB SKILLCHAIN_ELEMENT ids. The chain table is `skillchain()` in `ffxi.ts`.
- Trusts: `trusts` (build-db `seedTrusts`) comes from the bg-wiki `CatsEyeXI_Systems/Trusts` tables (role = section, ACE/CW from the icons), and `spellid` is matched to LSB `spell_list` (896+, UC trusts are short names like `naja_uc`). Ark Angel EV has no LSB spell. The addon sends `trustKnown` (HasSpell 896-1023), and the Trusts page keeps it in kv `trustKnown`.
- Weapon skill trials: the addon sends each equipped weapon's extdata uint16 at offset 0 (LSB `Exdata::WeaponUnlock.UnlockPoints`); the target is `item_weapon.unlock_points`. The server never resends the weapon after adding points (it only reaches the client on zoning), so App also counts your own weapon skills (`wsUsed`, 0x028 category 3) and banks `wsPoints()` per weapon skill once you gain EXP/limit (points only come from mobs that give EXP). Progress is saved in kv `wsTrials` (`points` exact, `extra` estimate); a popup fires when a weapon completes. On CatseyeXI the Sapara of Trials still read 0 in its extdata after zoning, though other items' extdata reads fine, so CatseyeXI likely tracks trial progress differently and the app's count is the only progress shown (unconfirmed).
- `accountType` 1 = Crystal Warrior (the site hides AH and delivery for it). Other values aren't documented.
- Character art: `src/components/Portrait.tsx` sprites one 5×4 sheet per race from `src/assets/portraits` (cells in job id order WAR..SCH, both genders share a sheet; API `race` 1-2 Hume, 3-4 Elvaan, 5-6 Tarutaru (no sheet yet), 7 Mithra, 8 Galka). The sheets are the user's own Gemini art, downscaled to 1200px wide with ffmpeg; the originals in `images/` are gitignored.
- RoE limited-time challenges follow LSB `scripts/globals/roe.lua` `timedSchedule` (4h JST blocks; it matches CatseyeXI's "Gain Experience 3×/week"), copied into `timedRoe()` in `ffxi.ts`. Training hides timed rows from earlier blocks; Remove on a row hides it (kv `trainingHidden`) until newer progress.
- `src/ctx.ts` holds the React context. Don't name it `app.ts`: it collides with `App.tsx` on case-insensitive Windows.
- **Zone maps** come from bg-wiki: Square Enix maps with fan annotations, so they're not public domain and are never bundled. `seedMaps` in `build-db.ts` stores only the file list and URLs in `zone_maps`. The app downloads each image to `%APPDATA%\com.ffxi.catseyecompanion\maps` on first view (`src/maps.ts`, using the fs plugin scoped to that folder plus the asset protocol).
- **Map calibration**, `px = a*x + b`, `py = c*z + d`, is fitted at build time:
  - Calibration points come from bg-wiki Zone Geography rows matched to LSB `zonelines` from/to coordinates, and wiki NPC rows matched to unique `npc_list` names.
  - The fit uses a shared scale with north up, outlier rejection, and a minimum 3-cell spread. Grid cell centre is `36 + 32*i` px on a 512 map.
  - Roughly a third of map files calibrate, mostly outdoor zones. Dungeon floors fall back to in-app drag-to-fit, saved in `user.db.map_fit`.
  - Raw points are in `zone_map_pairs` for debugging.

## Game addon (addon/catseyecompanion)

CatseyeXI launches through **VanaCore**, which runs Ashita v4 addons (interface 4.16) from `Vanacore/addons/ashita`. The CatseyeXI moderation team approved the addon (2026-10-25) on the basis that it is read-only. It must stay **T2 Information** under catseyexi.com/addon-policy:
- It only reads client memory and observes `packet_in`.
- It never sends packets, queues commands, writes memory, or blocks or modifies packets.
- Keep the policy grep in the README clean.
- `blu.lua` is the read-only part of `blusets` (GPLv3, atom0s). Don't bring back its set/equipex code.

How data flows:
- The addon writes `%APPDATA%\com.ffxi.catseyecompanion\live.json` about once a second (atomic rename; heartbeat every 5s).
- `src/live.ts` reads it and `App.tsx` exposes `live` through context. `live` is null unless the file is under 12s old and its `char` matches the loaded character.
- Every feature has to work without it.

Contents of `live.json`:
- `pos` is in LSB convention (y = height). Ashita's X/Y are the ground plane, so the addon swaps axes. Settings cross-checks it against catseyexi.com's position.
- `bluKnown` holds [client id, name] pairs; LSB spell ids equal client ids. App mirrors it into `user.db.blu_learned` for spells LSB knows; CatseyeXI-only spells stay manual.
- `events` ("learns" message 419) feed popups and `blu_history`.
- `bluSet` holds client ids from a memory signature, plus `bluPoints`.
- `storage` covers every bag.
- `ventureLog` (name kept from its first use) holds tracked chat lines from `text_in`: Ventures, replies to your own `!` commands, training regime / Records of Eminence / "(n/m)" progress. `n` is a per-addon-run line number, so identical lines in one second stay distinct. App appends them to kv `ventureLog` (last 500); Progress parses `parseVentures`, Training `parseTraining`.
- `logs` holds raw 0x056 payloads per port. They're decoded in the app (`decodeLogs`) against `quest_names` / `mission_names`, which come from LSB `scripts/globals/quests.lua` / `missions.lua` via `git show`.

Testing without the game: write a `live.json` in the same format, using the user's real character name and current learned list, so the learned sync stays a no-op. Clean up any test `blu_history` rows afterwards.

## Layout

- `reference.db`: bundled, read-only, gitignored; rebuild it with `build-db`.
- `user.db`: in `%APPDATA%\com.ffxi.catseyecompanion`, migrated inline in `src/db.ts`.
- Pages are in `src/pages`, with page switching done by a `useState` in `App.tsx`. There's no router or state library; keep it that way.
