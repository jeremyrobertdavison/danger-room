# Danger Room

**Danger Room** is a Foundry Virtual Tabletop module that adds a GM-controlled automated training encounter for the unofficial **Marvel Multiverse RPG** Foundry system.

Version 1 is intentionally simple: the GM prepares a group of training enemies, assigns each enemy one close attack, and manually starts the simulation. The enemies automatically pursue the nearest conscious hero, make their configured attack, apply damage, and pass the turn back into Foundry's normal initiative order.

> This is a fan-made module. It is not affiliated with or endorsed by Marvel Entertainment, The Walt Disney Company, Foundry Gaming LLC, or the maintainers of the unofficial Marvel Multiverse Foundry system. No copyrighted game rules or sourcebook content are distributed with this module.

## Version 1.0.1 Features

- Danger Room is enabled **per Scene**.
- GM manually starts and stops each simulation.
- Enemy tokens are captured at their placed locations and hidden until the simulation begins.
- Each enemy is assigned one attack to use for the entire simulation.
- Enemies automatically target the nearest conscious player character.
- Equal-distance ties are resolved randomly.
- Enemies use their Run movement to travel directly toward their target.
- Enemies attack when they reach their configured close-attack reach.
- Enemy attacks use the Marvel Multiverse system's native attack roll.
- Danger Room automatically checks the attack against the target defense and applies Health or Focus damage.
- Enemy turns end automatically and initiative proceeds normally.
- If every participating hero reaches 0 Health or below, the simulation ends and heroes are restored to full Health.
- If every training enemy is defeated, the simulation ends in victory.
- Training enemies reset to full Health/Focus, return to their spawn locations, and become hidden after a simulation.
- Per-Scene scoreboard tracks simulations, wins, losses, aborted runs, enemies defeated, highest round, best victory time, and the most recent result.

## Requirements

- Foundry Virtual Tabletop **v13** (verified against the v13 API family)
- The unofficial `marvel-multiverse` Foundry game system
- A connected GM client while the simulation is running

## Installation

### Manifest URL

In Foundry's **Add-on Modules** setup screen, choose **Install Module** and use:

`https://raw.githubusercontent.com/jeremyrobertdavison/danger-room/main/module.json`

### Manual Installation

Download `danger-room-v1.0.1.zip` from the GitHub Releases page and extract it into:

`Data/modules/danger-room/`

Then restart Foundry and enable **Danger Room** in the desired world.

## Scene Setup

1. Open the Scene that will serve as the Danger Room.
2. Place each training enemy token where that enemy should appear when the simulation starts.
3. For best results, use **unlinked NPC tokens** for training enemies. Multiple linked tokens using the same Actor share the same Health pool in Foundry.
4. Select all enemy tokens you want to use.
5. Open **Token Controls** and click **Danger Room: Configure**.
6. Click **Capture Selected**.
7. Re-opened configuration will list each captured enemy. Choose the single close attack that enemy should use.
8. Check **Enable Danger Room on this Scene** and click **Save**.
9. Captured enemy tokens are hidden while the room is idle.
10. Place the players' normal character tokens on the Scene. Participating heroes are active, non-GM player-owned Actors of type `character`.
11. Click **Danger Room: Start Simulation**.

Danger Room reveals the training enemies, resets them, creates combatants, rolls initiative for everyone, and begins combat.

## Enemy AI in Version 1

The Version 1 behavior is intentionally predictable:

1. Find all conscious participating heroes.
2. Measure the distance to each hero.
3. Choose the nearest hero. If multiple heroes are tied, choose randomly among them.
4. Move directly toward that hero by up to the enemy's Run speed.
5. If the target is within the configured attack's reach, perform the configured attack.
6. Resolve hit/miss and damage.
7. End the enemy's turn.

### Movement Limitation

Version 1 does **not** perform tactical pathfinding around walls, doors, hazards, or other tokens. It moves enemies in a direct line toward their target. Build initial Danger Room arenas with relatively open movement lanes.

Wall-aware pathfinding is a candidate for a later release.

## Defeat, Victory, and Reset

### Hero Defeat

When every participating hero reaches 0 Health or below:

- combat ends;
- all participating heroes are restored to maximum Health;
- training enemies are restored to maximum Health and Focus;
- training enemies return to their captured spawn locations;
- training enemies are hidden;
- the scoreboard records the loss and defeated enemies.

### Victory

When every configured training enemy reaches 0 Health or below:

- combat ends;
- the scoreboard records the victory and completion time;
- training enemies reset and return to their spawn locations;
- training enemies are hidden.

Heroes are **not automatically healed after a victory** in Version 1.

### Manual Stop

The GM can click **Danger Room: Stop / Reset** at any time. The run is recorded as aborted, heroes are restored to full Health, and the training room returns to its idle state.

## Scoreboard

Click **Danger Room: Scoreboard** from Token Controls to see statistics stored on the current Scene:

- simulations started;
- wins and losses;
- aborted simulations;
- total training enemies defeated;
- highest combat round reached;
- fastest victory;
- last result;
- last run duration.

Scoreboards are Scene-specific so different Danger Room arenas can maintain their own records.

## Planned Directions

The Version 1 architecture is intentionally small so later releases can add more sophisticated behavior without replacing the core simulation controller. Potential future features include:

- automatic multi-wave encounters;
- ranged attacks;
- selectable AI personalities;
- ability and power selection;
- threat/priority targeting;
- wall-aware movement and pathfinding;
- player-specific statistics;
- difficulty presets;
- encounter pools and random enemy selection;
- autonomous operation without the primary GM client.

No timeline is promised for any planned feature.

## Troubleshooting

### No heroes are found

Danger Room only includes `character` tokens owned by **active non-GM users**. Confirm the player is connected and has Owner permission for the Actor represented by the token.

### An enemy has no selectable attack

The Marvel Multiverse Item must be configured as an attack. Version 1 prefers close attacks. Review the attack on the enemy Actor sheet and then reopen Danger Room configuration.

### Several enemies lose Health at the same time

Those tokens are probably linked to the same Actor. Use unlinked NPC tokens for separate training opponents.

### An enemy walks through a wall

This is a known Version 1 limitation. Movement is direct-line rather than pathfinding-based.

### A configured enemy was deleted

Open Danger Room configuration, clear/re-capture the enemy list, and save again.

## API

A small API is exposed for macros and future integrations:

```js
const dangerRoom = game.modules.get("danger-room").api;
await dangerRoom.start();
await dangerRoom.stop();
dangerRoom.configure();
dangerRoom.scoreboard();
await dangerRoom.captureSelected();
```

## License

Danger Room is released under the MIT License. See [LICENSE](LICENSE).
