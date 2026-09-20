# Changelog

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
