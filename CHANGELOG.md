# Changelog

## 1.0.5

- Fixed a race where a training enemy could reach 0 Health but the victory/knockout check could be skipped while turn processing was active.
- Player-inflicted damage now performs an immediate simulation outcome check after the damage is applied.
- Outcome checks now retry instead of being discarded when NPC turn automation is temporarily busy.
- Training enemies that reach 0 Health are immediately marked defeated and hidden, while their Token documents remain available for automatic reset.
- Enemy knockout IDs are persisted immediately so scoreboard totals remain correct even when the final enemy ends the simulation.

## 1.0.4

- Fixed MVRPG enemy hits not reducing hero Health/Focus by moving Danger Room damage resolution onto the prepared attacker/target Actor data used by the installed `mvrpg` system.
- Added automatic damage application for successful player combat rolls against Danger Room training enemies while a simulation is active.
- Player damage is resolved by the active GM client, so players do not need ownership permission on training-enemy Actors.
- Uses the player's targeted training enemy; when exactly one conscious training enemy remains, Danger Room can resolve it automatically even if the player forgot to target.
- Added synthetic-token-safe lifepool verification and combatant defeat handling.
- Prevented the MVRPG native damage-card message from causing duplicate Danger Room damage application.

## 1.0.3

- Fixed player hero detection in Foundry VTT v13 by using the named `OWNER` permission level expected by `Document#testUserPermission`.
- Added assigned-character matching so an active user's selected Character token is recognized even when a synthetic Token Actor complicates normal ownership checks.
- Added ownership-level fallbacks for synthetic/unlinked Actors.
- Added console diagnostics when no hero participants can be detected.

## 1.0.2

- Fixed Scene Controls not appearing in worlds using the `mvrpg` system ID.
- Added native `mvrpg` v3.x actor paths for Health, Focus, Run speed, and player-owned `super` Actors.
- Added a universal **Basic Melee Attack** option for every configured enemy.
- Added `mvrpg` D616 automated attack resolution, defense targeting, damage calculation, and Health/Focus application.
- Preserved best-effort compatibility with the older `marvel-multiverse` system adapter.


## 1.0.1

- Removed the unnecessary Marvel Multiverse package relationship from `module.json` so Foundry 13 consistently lists Danger Room in world Module Management.
- Added a runtime system guard for the Danger Room scene controls.

## 1.0.0

Initial public release.

- Per-Scene Danger Room configuration.
- Capture placed enemy tokens as training opponents and spawn locations.
- Select one close attack per configured enemy.
- Manual GM Start and Stop/Reset controls.
- Automatic initiative setup.
- Nearest-conscious-hero targeting with random tie breaking.
- Direct Run-speed movement toward the selected target.
- Native Marvel Multiverse attack rolls with automated defense checks and damage application.
- Automatic NPC turn advancement.
- Victory and defeat detection.
- Full-Health hero recovery after defeat or manual abort.
- Enemy reset/hide behavior.
- Per-Scene scoreboard.
- Public module API for macros and future integrations.
