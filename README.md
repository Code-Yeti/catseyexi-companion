# CatseyeXI Companion

A Windows desktop companion for playing FFXI on the [CatseyeXI](https://catseyexi.com) private server. It runs alongside the game and never touches the client.

- **Character**: enter your CatseyeXI character id or URL (e.g. `https://catseyexi.com/char/25929`). The app pulls your jobs, gear, crafts and owned items from the public catseyexi.com API and caches them for offline use.
- **Blue Magic**: every spell available on CatseyeXI, including the custom and relocated ones from bg-wiki. Each spell lists the mobs and zones that teach it, with spawn points plotted, and a learned checklist.
- **Search / Mob / Item**: drops, droppers, spawn zones and levels. Item stats come live from CatseyeXI, and each mob is checked against CatseyeXI's own mob database.
- **Gear planner**: gear sets per job, stat totals, and what you still need, checked against your inventory.
- **Progress**: CatsEyeXI custom quests (with ACE/CW/WEW modes), mission lists, and your own checklists.

## Setup

You need Node 24+, Rust (rustup), and the VS 2022 Build Tools with the C++ workload.

```sh
npm install
# Game data: LandSandBoat at the last SQL-based commit (CatseyeXI forks this era of LSB)
git clone --filter=blob:none --sparse https://github.com/LandSandBoat/server.git ../FFXI-lsb
cd ../FFXI-lsb && git sparse-checkout set sql data/enums && git checkout c92debd129e88665918c6c4a69a7f28a9ee672cb && cd -
npm run build-db      # -> src-tauri/resources/reference.db + data/diff-report.md
npm run tauri dev     # run
npm run tauri build   # -> src-tauri/target/release/bundle/msi/*.msi
```

## Maps

Zone maps come from [bg-wiki](https://www.bg-wiki.com): Square Enix's in-game maps with community annotations (mob areas, NMs, ???s). They aren't redistributed with the app. Each one downloads to your own AppData folder the first time you view it, or all at once from Settings.

Most outdoor maps calibrate automatically, so spawn dots land where they should. For maps that don't (mostly dungeon floors), click **Fit dots**, then drag and scroll the grey dots (every spawn in the zone) onto the map's marked areas and save.

## Game addon (optional)

`addon/catseyecompanion` is a small Ashita addon that lets the app see what your game client already knows:
- your live position on the map, plus "Mark my position" calibration for any map
- the mob you're targeting
- which blue spells you've learned (and where you learned them)
- your current spell set, set points and active traits
- every storage bag
- your quest and mission log

It only reads. It never sends anything to the server, which keeps it in CatseyeXI's **T2 Information** tier ([addon policy](https://catseyexi.com/addon-policy)). If you share it, open a GM ticket with the source as the policy asks.

```sh
npm run install-addon            # copies it into VanaCore's Ashita addons folder
```

Then, in game, run `/addon load catseyecompanion ashita`, or add it on the VanaCore launcher's Addons page. `/csc` shows its status.

Policy self-check (should print nothing):

```sh
grep -nE "packet_out|QueueCommand|QueuePacket|AddOutgoingPacket|memory.write" addon/catseyecompanion/*.lua
```
