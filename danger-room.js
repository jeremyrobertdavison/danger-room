const MODULE_ID = "danger-room";
const FLAG_CONFIG = "config";
const FLAG_ACTIVE = "active";
const FLAG_SCORE = "scoreboard";

const runtime = {
  processing: false,
  resetting: false,
  outcomeTimer: null,
  turnTimer: null,
};

const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  enemies: [],
});

const DEFAULT_SCORE = Object.freeze({
  simulations: 0,
  wins: 0,
  losses: 0,
  aborts: 0,
  enemiesDefeated: 0,
  highestRound: 0,
  bestVictoryMs: null,
  lastOutcome: "Never run",
  lastDurationMs: null,
});

Hooks.once("init", () => {
  console.log("Danger Room | Initializing v1.0.4");
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = {
      start: () => startSimulation(canvas.scene),
      stop: () => stopSimulation(canvas.scene),
      configure: () => openConfig(canvas.scene),
      scoreboard: () => showScoreboard(canvas.scene),
      captureSelected: () => captureSelectedEnemies(canvas.scene),
    };
  }
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  if (!["mvrpg", "marvel-multiverse"].includes(game.system?.id)) return;
  const tokenControl = controls?.tokens;
  if (!tokenControl?.tools) return;

  const baseOrder = Object.keys(tokenControl.tools).length + 20;

  tokenControl.tools["danger-room-config"] = {
    name: "danger-room-config",
    title: "Danger Room: Configure",
    icon: "fa-solid fa-gears",
    order: baseOrder,
    button: true,
    visible: true,
    onChange: () => openConfig(canvas.scene),
  };

  tokenControl.tools["danger-room-start"] = {
    name: "danger-room-start",
    title: "Danger Room: Start Simulation",
    icon: "fa-solid fa-play",
    order: baseOrder + 1,
    button: true,
    visible: true,
    onChange: () => startSimulation(canvas.scene),
  };

  tokenControl.tools["danger-room-stop"] = {
    name: "danger-room-stop",
    title: "Danger Room: Stop / Reset",
    icon: "fa-solid fa-stop",
    order: baseOrder + 2,
    button: true,
    visible: true,
    onChange: () => stopSimulation(canvas.scene),
  };

  tokenControl.tools["danger-room-scoreboard"] = {
    name: "danger-room-scoreboard",
    title: "Danger Room: Scoreboard",
    icon: "fa-solid fa-ranking-star",
    order: baseOrder + 3,
    button: true,
    visible: true,
    onChange: () => showScoreboard(canvas.scene),
  };
});

Hooks.on("canvasReady", async (canvasInstance) => {
  if (!isAutomationGM()) return;
  const scene = canvasInstance?.scene ?? canvas.scene;
  if (!scene) return;
  await recoverOrPrepareScene(scene);
});

Hooks.on("updateCombat", (combat) => {
  if (!isAutomationGM() || runtime.resetting) return;
  const scene = getSceneForCombat(combat);
  const active = scene?.getFlag(MODULE_ID, FLAG_ACTIVE);
  if (!active || active.combatId !== combat.id) return;
  scheduleTurnProcessing();
});

Hooks.on("updateActor", () => scheduleOutcomeCheck());
Hooks.on("updateToken", () => scheduleOutcomeCheck());

// Player attack rolls are created on the player's client, but the resulting
// ChatMessage is synchronized to the GM. The active GM resolves Danger Room
// damage so players never need permission to edit training-enemy Actors.
Hooks.on("createChatMessage", (message) => {
  if (!isAutomationGM() || runtime.resetting) return;
  window.setTimeout(() => maybeApplyPlayerAttackDamage(message), 250);
});

function isAutomationGM() {
  if (!game.user?.isGM) return false;
  if (typeof game.user.isActiveGM === "boolean") return game.user.isActiveGM;
  return true;
}

function clone(value) {
  return foundry.utils.deepClone(value);
}

function getConfig(scene) {
  return foundry.utils.mergeObject(clone(DEFAULT_CONFIG), clone(scene?.getFlag(MODULE_ID, FLAG_CONFIG) ?? {}), {
    inplace: false,
  });
}

function getScore(scene) {
  return foundry.utils.mergeObject(clone(DEFAULT_SCORE), clone(scene?.getFlag(MODULE_ID, FLAG_SCORE) ?? {}), {
    inplace: false,
  });
}

async function setConfig(scene, config) {
  return scene.setFlag(MODULE_ID, FLAG_CONFIG, config);
}

async function setScore(scene, score) {
  return scene.setFlag(MODULE_ID, FLAG_SCORE, score);
}

function esc(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function getSceneForCombat(combat) {
  const sceneId = combat?.scene?.id ?? combat?.scene ?? canvas.scene?.id;
  return game.scenes.get(sceneId) ?? canvas.scene;
}

function tokenActor(tokenDoc) {
  return tokenDoc?.actor ?? null;
}

function healthValue(tokenDoc) {
  const system = tokenActor(tokenDoc)?.system;
  return Number(system?.lifepool?.health?.value ?? system?.health?.value ?? 0);
}

function healthMax(tokenDoc) {
  const system = tokenActor(tokenDoc)?.system;
  return Number(system?.lifepool?.health?.max ?? system?.health?.max ?? 0);
}

function focusMax(tokenDoc) {
  const system = tokenActor(tokenDoc)?.system;
  return Number(system?.lifepool?.focus?.max ?? system?.focus?.max ?? 0);
}

function healthPath(actor) {
  return actor?.system?.lifepool?.health ? "system.lifepool.health.value" : "system.health.value";
}

function focusPath(actor) {
  return actor?.system?.lifepool?.focus ? "system.lifepool.focus.value" : "system.focus.value";
}

function isConscious(tokenDoc) {
  return healthValue(tokenDoc) > 0;
}

function assignedCharacterId(user) {
  const character = user?.character;
  if (!character) return null;
  if (typeof character === "string") return character;
  return character.id ?? character._id ?? null;
}

function userOwnsTokenActor(user, tokenDoc) {
  if (!user?.active || user.isGM || !tokenDoc?.actor) return false;

  const actor = tokenDoc.actor;
  const actorIds = new Set([actor.id, actor._id, tokenDoc.actorId].filter(Boolean));
  const assignedId = assignedCharacterId(user);

  // A user's selected Character is the strongest signal that this token is their hero.
  // Checking tokenDoc.actorId also handles synthetic/unlinked token Actors.
  if (assignedId && actorIds.has(assignedId)) return true;

  // Foundry v13 expects the named ownership level here rather than the numeric constant.
  try {
    if (actor.testUserPermission?.(user, "OWNER")) return true;
  } catch (error) {
    console.debug("Danger Room | Actor permission test failed; trying fallbacks", error);
  }

  const ownerLevel = Number(CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);

  try {
    const level = Number(actor.getUserLevel?.(user));
    if (Number.isFinite(level) && level >= ownerLevel) return true;
  } catch (error) {
    console.debug("Danger Room | Actor ownership-level lookup failed", error);
  }

  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  const level = Number(ownership[user.id] ?? ownership.default ?? 0);
  return Number.isFinite(level) && level >= ownerLevel;
}

function activePlayerOwners(tokenDoc) {
  if (!tokenDoc?.actor) return [];
  return game.users.filter((user) => userOwnsTokenActor(user, tokenDoc));
}

function participantTokens(scene, enemyIds = []) {
  const enemySet = new Set(enemyIds);
  return scene.tokens.filter((token) => {
    if (!token.actor || enemySet.has(token.id)) return false;
    return activePlayerOwners(token).length > 0;
  });
}

function participantDiagnostics(scene, enemyIds = []) {
  const enemySet = new Set(enemyIds);
  return {
    activePlayers: game.users
      .filter((user) => user.active && !user.isGM)
      .map((user) => ({
        id: user.id,
        name: user.name,
        characterId: assignedCharacterId(user),
        characterName: typeof user.character === "object" ? user.character?.name ?? null : null,
      })),
    sceneTokens: scene.tokens
      .filter((token) => !enemySet.has(token.id))
      .map((token) => ({
        id: token.id,
        name: token.name,
        actorId: token.actorId,
        actorName: token.actor?.name ?? null,
        actorType: token.actor?.type ?? null,
        activeOwners: activePlayerOwners(token).map((user) => user.name),
      })),
  };
}

function isMvrpg() {
  return game.system?.id === "mvrpg";
}

function closeAttacks(actor) {
  if (!actor) return [];

  if (isMvrpg()) {
    const attacks = actor.items.filter((item) => {
      const roll = item.system?.roll;
      return roll?.hasRoll === true && roll?.type === "combat" && roll?.lifepoolTarget !== "none";
    });
    const close = attacks.filter((item) => {
      const range = item.system?.range;
      const raw = String(range?._value ?? range?.value ?? "").trim();
      return !raw || range?.reach === true;
    });
    return close.length ? close : attacks;
  }

  const attacks = actor.items.filter((item) => item.system?.attack === true);
  const close = attacks.filter((item) => {
    const attackKind = String(item.system?.attackKind ?? item.system?.kind ?? "").toLowerCase();
    const range = String(item.system?.range ?? "").toLowerCase();
    return attackKind === "close" || range.includes("reach");
  });
  return close.length ? close : attacks;
}

function attackChoices(actor) {
  const choices = [{ id: "__basic-melee__", name: "Basic Melee Attack", basic: true }];
  for (const item of closeAttacks(actor)) choices.push({ id: item.id, name: item.name, item });
  return choices;
}

async function openConfig(scene) {
  if (!game.user.isGM) return;
  if (!scene) return ui.notifications.warn("Danger Room requires an active Scene.");

  const config = getConfig(scene);
  const rows = config.enemies.map((entry) => {
    const token = scene.tokens.get(entry.tokenId);
    const actor = token?.actor ?? game.actors.get(entry.actorId);
    const attacks = attackChoices(actor);
    const options = attacks.map((choice) => `<option value="${choice.id}" ${choice.id === entry.attackId ? "selected" : ""}>${esc(choice.name)}</option>`).join("");

    return `
      <tr>
        <td>${esc(token?.name ?? entry.name ?? "Missing Token")}</td>
        <td>${esc(actor?.name ?? "Missing Actor")}</td>
        <td><select name="attack-${esc(entry.tokenId)}">${options}</select></td>
        <td>${Math.round(entry.spawn?.x ?? 0)}, ${Math.round(entry.spawn?.y ?? 0)}</td>
      </tr>`;
  }).join("");

  const content = `
    <form class="danger-room-config">
      <div class="dr-intro">
        <strong>Version 1 workflow:</strong> Place enemy tokens at their desired spawn locations, select them, then choose <em>Capture Selected</em>. Captured enemies stay hidden until the GM starts the simulation.
      </div>
      <div class="dr-row">
        <label for="dr-enabled"><strong>Enable Danger Room on this Scene</strong></label>
        <input id="dr-enabled" name="enabled" type="checkbox" ${config.enabled ? "checked" : ""}>
      </div>
      <p class="dr-muted">Participants are tokens owned by active non-GM players. Enemies use only the selected close attack and always pursue the nearest conscious hero. <strong>Basic Melee Attack</strong> is available for every enemy.</p>
      <table class="dr-enemy-table">
        <thead><tr><th>Token</th><th>Actor</th><th>Attack</th><th>Spawn X/Y</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4"><em>No enemies captured yet.</em></td></tr>`}</tbody>
      </table>
    </form>`;

  new Dialog({
    title: `Danger Room — ${scene.name}`,
    content,
    buttons: {
      save: {
        icon: '<i class="fas fa-floppy-disk"></i>',
        label: "Save",
        callback: async (html) => {
          const root = html?.[0] ?? html;
          const form = root.querySelector("form");
          config.enabled = form.querySelector('[name="enabled"]')?.checked ?? false;
          for (const entry of config.enemies) {
            entry.attackId = form.querySelector(`[name="attack-${CSS.escape(entry.tokenId)}"]`)?.value ?? entry.attackId ?? "";
          }
          await setConfig(scene, config);
          await setCapturedVisibility(scene, config, !config.enabled);
          ui.notifications.info(`Danger Room configuration saved for ${scene.name}.`);
        },
      },
      capture: {
        icon: '<i class="fas fa-crosshairs"></i>',
        label: "Capture Selected",
        callback: async () => {
          await captureSelectedEnemies(scene);
          setTimeout(() => openConfig(scene), 100);
        },
      },
      clear: {
        icon: '<i class="fas fa-trash"></i>',
        label: "Clear Enemies",
        callback: async () => {
          await clearCapturedEnemies(scene);
          setTimeout(() => openConfig(scene), 100);
        },
      },
    },
    default: "save",
  }, { width: 760 }).render(true);
}

async function captureSelectedEnemies(scene) {
  if (!game.user.isGM) return;
  if (!scene || canvas.scene?.id !== scene.id) return ui.notifications.warn("Open the Scene you want to configure first.");

  const selected = canvas.tokens.controlled.map((token) => token.document).filter(Boolean);
  if (!selected.length) return ui.notifications.warn("Select one or more enemy tokens first.");

  const config = getConfig(scene);
  const byId = new Map(config.enemies.map((entry) => [entry.tokenId, entry]));

  for (const token of selected) {
    const attacks = attackChoices(token.actor);
    const old = byId.get(token.id);
    const oldStillValid = old?.attackId === "__basic-melee__" || token.actor?.items.get(old?.attackId);
    byId.set(token.id, {
      tokenId: token.id,
      actorId: token.actor?.id ?? token.actorId,
      name: token.name,
      attackId: oldStillValid ? old.attackId : (attacks[0]?.id ?? "__basic-melee__"),
      spawn: {
        x: token.x,
        y: token.y,
        elevation: token.elevation ?? 0,
        rotation: token.rotation ?? 0,
      },
    });
  }

  config.enemies = Array.from(byId.values());
  await setConfig(scene, config);
  await scene.updateEmbeddedDocuments("Token", selected.map((token) => ({ _id: token.id, hidden: true })));
  canvas.tokens.releaseAll();

  ui.notifications.info(`Captured ${selected.length} enemy token(s) for Danger Room.`);
}

async function clearCapturedEnemies(scene) {
  const config = getConfig(scene);
  const ids = config.enemies.map((entry) => entry.tokenId).filter((id) => scene.tokens.get(id));
  if (ids.length) await scene.updateEmbeddedDocuments("Token", ids.map((id) => ({ _id: id, hidden: false })));
  config.enemies = [];
  await setConfig(scene, config);
  ui.notifications.info("Danger Room enemy list cleared.");
}

async function setCapturedVisibility(scene, config, visible) {
  if (scene.getFlag(MODULE_ID, FLAG_ACTIVE)) return;
  const updates = config.enemies
    .filter((entry) => scene.tokens.get(entry.tokenId))
    .map((entry) => ({ _id: entry.tokenId, hidden: !visible }));
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
}

async function startSimulation(scene) {
  if (!game.user.isGM) return;
  if (!scene) return ui.notifications.warn("Danger Room requires an active Scene.");
  if (canvas.scene?.id !== scene.id) return ui.notifications.warn("Activate the Danger Room Scene before starting the simulation.");

  const config = getConfig(scene);
  if (!config.enabled) return ui.notifications.warn("Danger Room is not enabled on this Scene. Open Danger Room: Configure first.");
  if (!config.enemies.length) return ui.notifications.warn("No Danger Room enemies are configured.");
  if (scene.getFlag(MODULE_ID, FLAG_ACTIVE)) return ui.notifications.warn("A Danger Room simulation is already active on this Scene.");
  if (game.combat?.started) return ui.notifications.warn("Finish the current combat encounter before starting Danger Room.");

  const enemies = config.enemies.map((entry) => scene.tokens.get(entry.tokenId)).filter(Boolean);
  if (enemies.length !== config.enemies.length) return ui.notifications.error("One or more configured enemy tokens no longer exist. Reconfigure the Scene.");

  for (const entry of config.enemies) {
    const token = scene.tokens.get(entry.tokenId);
    const attack = entry.attackId === "__basic-melee__" ? { basic: true } : token?.actor?.items.get(entry.attackId);
    if (!attack) return ui.notifications.error(`${token?.name ?? entry.name} is missing its configured attack. Open Danger Room: Configure.`);
  }

  const enemyIds = enemies.map((token) => token.id);
  const heroes = participantTokens(scene, enemyIds);
  if (!heroes.length) {
    const diagnostics = participantDiagnostics(scene, enemyIds);
    console.warn("Danger Room | No hero participants detected", diagnostics);
    const playerNames = diagnostics.activePlayers.map((player) => player.name).join(", ") || "none";
    return ui.notifications.warn(`No player hero tokens were detected on this Scene. Active non-GM users: ${playerNames}. See the browser console for Danger Room participant diagnostics.`);
  }

  runtime.resetting = true;
  try {
    await resetEnemyTokens(scene, config, { hide: false });
    const allTokens = [...heroes, ...enemies];
    await TokenDocument.createCombatants(allTokens);
    const combat = game.combat;
    if (!combat) throw new Error("Foundry did not create a combat encounter.");

    const score = getScore(scene);
    score.simulations += 1;
    score.lastOutcome = "In progress";
    score.lastDurationMs = null;
    await setScore(scene, score);

    await scene.setFlag(MODULE_ID, FLAG_ACTIVE, {
      combatId: combat.id,
      startTime: Date.now(),
      heroTokenIds: heroes.map((token) => token.id),
      enemyTokenIds: enemies.map((token) => token.id),
      enemyKOIds: [],
    });

    await combat.rollAll();
    await combat.startCombat();

    await ChatMessage.create({
      content: `<div class="danger-room-chat"><strong>DANGER ROOM SIMULATION STARTED</strong><br>${heroes.length} hero${heroes.length === 1 ? "" : "es"} vs. ${enemies.length} training opponent${enemies.length === 1 ? "" : "s"}.</div>`,
      speaker: { alias: "Danger Room" },
    });

    showOverlay("SIMULATION STARTED", `${enemies.length} training opponent${enemies.length === 1 ? "" : "s"} online.`);
  } catch (error) {
    console.error("Danger Room | Failed to start simulation", error);
    ui.notifications.error(`Danger Room failed to start: ${error.message}`);
  } finally {
    runtime.resetting = false;
  }

  scheduleTurnProcessing(350);
}

async function stopSimulation(scene) {
  if (!game.user.isGM) return;
  if (!scene) return;
  const active = scene.getFlag(MODULE_ID, FLAG_ACTIVE);
  const config = getConfig(scene);

  if (!active) {
    await resetEnemyTokens(scene, config, { hide: true });
    return ui.notifications.info("Danger Room reset to idle state.");
  }

  await finishSimulation(scene, "aborted", { healHeroes: true });
}

function scheduleTurnProcessing(delay = 200) {
  if (!isAutomationGM() || runtime.resetting) return;
  clearTimeout(runtime.turnTimer);
  runtime.turnTimer = setTimeout(() => processCurrentTurn(), delay);
}

function scheduleOutcomeCheck() {
  if (!isAutomationGM() || runtime.resetting || runtime.processing) return;
  clearTimeout(runtime.outcomeTimer);
  runtime.outcomeTimer = setTimeout(async () => {
    if (runtime.processing || runtime.resetting) return;
    const scene = canvas.scene;
    if (!scene?.getFlag(MODULE_ID, FLAG_ACTIVE)) return;
    await checkOutcome(scene);
  }, 175);
}

async function processCurrentTurn() {
  if (runtime.processing || runtime.resetting || !isAutomationGM()) return;
  const scene = canvas.scene;
  const active = scene?.getFlag(MODULE_ID, FLAG_ACTIVE);
  if (!scene || !active) return;

  const combat = game.combats.get(active.combatId) ?? game.combat;
  if (!combat?.started || combat.id !== active.combatId) return;

  runtime.processing = true;
  try {
    if (await checkOutcome(scene)) return;

    const current = combat.combatant;
    if (!current) return;
    if (!active.enemyTokenIds.includes(current.tokenId)) return;

    await executeEnemyTurn(scene, combat, current, active);
    if (await checkOutcome(scene)) return;

    const refreshed = scene.getFlag(MODULE_ID, FLAG_ACTIVE);
    if (!refreshed || refreshed.combatId !== combat.id) return;
    if (combat.combatant?.id === current.id) await combat.nextTurn();
  } catch (error) {
    console.error("Danger Room | Enemy turn failed", error);
    ui.notifications.error(`Danger Room enemy turn failed: ${error.message}`);
    try {
      if (combat.combatant && active.enemyTokenIds.includes(combat.combatant.tokenId)) await combat.nextTurn();
    } catch (advanceError) {
      console.error("Danger Room | Could not advance turn", advanceError);
    }
  } finally {
    runtime.processing = false;
  }

  scheduleTurnProcessing(150);
}

async function executeEnemyTurn(scene, combat, combatant, active) {
  const token = scene.tokens.get(combatant.tokenId);
  if (!token?.actor || !isConscious(token)) return;

  const config = getConfig(scene);
  const enemyConfig = config.enemies.find((entry) => entry.tokenId === token.id);
  if (!enemyConfig) return;

  const heroes = active.heroTokenIds.map((id) => scene.tokens.get(id)).filter((hero) => hero && isConscious(hero));
  if (!heroes.length) return;

  const target = nearestToken(token, heroes);
  if (!target) return;

  const attack = enemyConfig.attackId === "__basic-melee__" ? null : token.actor.items.get(enemyConfig.attackId);
  if (enemyConfig.attackId !== "__basic-melee__" && !attack) throw new Error(`${token.name} no longer has its configured attack.`);

  const reach = getAttackReach(token.actor, attack);
  let distance = tokenDistanceSpaces(token, target);
  if (distance > reach) {
    await moveTowardTarget(token, target, reach);
    await sleep(450);
    distance = tokenDistanceSpaces(token, target);
  }

  if (distance <= reach + 0.35) {
    await performAttack(token, target, attack, combat, { basic: enemyConfig.attackId === "__basic-melee__" });
    await sleep(650);
  } else {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token: token.object, actor: token.actor }),
      content: `<strong>${esc(token.name)}</strong> moves toward <strong>${esc(target.name)}</strong> but cannot reach them this turn.`,
    });
    await sleep(350);
  }
}

function nearestToken(origin, candidates) {
  if (!candidates.length) return null;
  let bestDistance = Infinity;
  let best = [];
  for (const candidate of candidates) {
    const distance = tokenDistanceSpaces(origin, candidate);
    if (distance < bestDistance - 0.01) {
      bestDistance = distance;
      best = [candidate];
    } else if (Math.abs(distance - bestDistance) <= 0.01) {
      best.push(candidate);
    }
  }
  return best[Math.floor(Math.random() * best.length)];
}

function tokenCenter(tokenDoc) {
  const gridSize = canvas.grid?.size ?? canvas.scene?.grid?.size ?? 100;
  return {
    x: tokenDoc.x + (Number(tokenDoc.width ?? 1) * gridSize) / 2,
    y: tokenDoc.y + (Number(tokenDoc.height ?? 1) * gridSize) / 2,
  };
}

function tokenDistanceSpaces(a, b) {
  const ac = tokenCenter(a);
  const bc = tokenCenter(b);
  try {
    const result = canvas.grid.measurePath([ac, bc]);
    const unitDistance = Number(canvas.grid.distance ?? canvas.scene?.grid?.distance ?? 5);
    if (Number.isFinite(result?.distance) && unitDistance > 0) return result.distance / unitDistance;
  } catch (error) {
    console.debug("Danger Room | Falling back to Euclidean distance", error);
  }
  const gridSize = canvas.grid?.size ?? 100;
  return Math.hypot(bc.x - ac.x, bc.y - ac.y) / gridSize;
}

function getAttackReach(actor, attack) {
  if (!attack) return 1;
  if (isMvrpg()) {
    const range = attack.system?.range;
    if (range?.reach === true) return 1;
    const raw = Number.parseFloat(range?._value ?? range?.value);
    return Number.isFinite(raw) && raw > 0 ? Math.max(1, raw) : 1;
  }

  const candidates = [attack.system?.attackRange, attack.system?.reach, actor.system?.reach, 1];
  for (const candidate of candidates) {
    const value = Number.parseFloat(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 1;
}

async function moveTowardTarget(token, target, reach) {
  const speed = Math.max(0, Number(token.actor?.system?.speed?.run ?? token.actor?.system?.movement?.run?.value ?? 0));
  if (!speed) return;

  const from = tokenCenter(token);
  const to = tokenCenter(target);
  const currentSpaces = tokenDistanceSpaces(token, target);
  const travelSpaces = Math.min(speed, Math.max(0, currentSpaces - reach));
  if (travelSpaces <= 0) return;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const gridSize = canvas.grid?.size ?? 100;
  const travelPixels = travelSpaces * gridSize;
  const nextCenter = {
    x: from.x + (dx / length) * travelPixels,
    y: from.y + (dy / length) * travelPixels,
  };

  const widthPx = Number(token.width ?? 1) * gridSize;
  const heightPx = Number(token.height ?? 1) * gridSize;
  const raw = { x: nextCenter.x - widthPx / 2, y: nextCenter.y - heightPx / 2 };
  const snapped = typeof token.getSnappedPosition === "function" ? token.getSnappedPosition(raw) : raw;
  await token.update({ x: snapped.x, y: snapped.y });
}

async function performAttack(attackerToken, targetToken, attack, combat, { basic = false } = {}) {
  if (canvas.scene?.id === attackerToken.parent?.id) {
    canvas.tokens.setTargets([targetToken.id], { mode: "replace" });
  }

  try {
    if (isMvrpg()) {
      return await performMvrpgAttack(attackerToken, targetToken, attack, combat, { basic });
    }
    return await performLegacyMarvelAttack(attackerToken, targetToken, attack, combat);
  } finally {
    canvas.tokens.setTargets([], { mode: "replace" });
  }
}

function mvrpgAbilityDefense(actor, abilityKey) {
  if (!abilityKey || abilityKey === "none") return 10;
  const ability = actor?.system?.abilities?.[abilityKey] ?? {};
  const derived = Number(ability.defense);
  if (Number.isFinite(derived)) return derived;
  return 10 + Number(ability.value ?? 0) + Number(ability.defenseBonus ?? 0);
}

async function performMvrpgAttack(attackerToken, targetToken, attack, combat, { basic = false } = {}) {
  const actor = attackerToken.actor;
  const targetActor = targetToken.actor;
  const rollData = basic ? {
    type: "combat",
    ability: "melee",
    against: "melee",
    lifepoolTarget: "health",
    bonus: 0,
    edges: 0,
    troubles: 0,
  } : attack.system?.roll;

  if (!rollData) throw new Error(`${attack?.name ?? "Attack"} does not contain MVRPG roll data.`);
  const D616 = game.mvrpg?.D616;
  if (!D616) throw new Error("The MVRPG D616 roll engine is unavailable.");

  const abilityKey = rollData.ability || "melee";
  const ability = actor.system?.abilities?.[abilityKey] ?? {};
  const modifier = Number(ability.value ?? 0) + Number(rollData.bonus ?? 0);
  const edges = Number(ability.edges ?? 0) + Number(rollData.edges ?? 0);
  const troubles = Number(ability.troubles ?? 0) + Number(rollData.troubles ?? 0);
  const against = rollData.against || abilityKey;
  const tn = against === "none" ? 10 + Number(targetActor.system?.rank ?? 0) : mvrpgAbilityDefense(targetActor, against);
  const lifepoolTarget = rollData.lifepoolTarget === "focus" ? "focus" : "health";
  const focusCost = basic ? 0 : Number(attack.system?.cost ?? 0);

  const roll = new D616("", {}, {
    rollType: "combat",
    ability: abilityKey,
    against,
    lifepoolTarget,
    modifier,
    edges,
    troubles,
    focusCost: 0,
    actor,
    item: basic ? null : attack,
    tn,
  });

  // Use Foundry's base Roll evaluator so NPC automation never pauses for the
  // MVRPG confirmation dialog. We handle the optional Focus cost below.
  await Roll.prototype.evaluate.call(roll, {});
  if (!roll?._evaluated) throw new Error("The automated D616 roll could not be evaluated.");

  if (focusCost > 0) {
    const currentFocus = Number(actor.system?.lifepool?.focus?.value ?? 0);
    await actor.update({ "system.lifepool.focus.value": currentFocus - focusCost });
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ token: attackerToken.object, actor }),
    flavor: `Danger Room — ${basic ? "Basic Melee Attack" : attack.name}`,
    flags: { [MODULE_ID]: { automatedNpcAttack: true } },
  });

  const total = Number(roll.finalResults?.total ?? roll.total ?? 0);
  const fantastic = Boolean(roll.fantasticResult || roll.ultimateFantasticResult);
  const hit = Boolean(roll.isSuccess);
  const attackName = basic ? "Basic Melee Attack" : attack.name;

  if (!hit) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token: attackerToken.object, actor }),
      content: `<strong>Danger Room:</strong> ${esc(attackerToken.name)} misses ${esc(targetToken.name)} (${esc(attackName)}: ${total} vs. Defense ${tn}).`,
    });
    return;
  }

  const damage = await applyMvrpgDamage({
    roll,
    attackerToken,
    targetToken,
    combat,
    lifepoolTarget,
    sourceName: attackName,
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: attackerToken.object, actor }),
    flags: { [MODULE_ID]: { automatedResult: true } },
    content: `<strong>Danger Room:</strong> ${esc(attackerToken.name)} hits ${esc(targetToken.name)} with <strong>${esc(attackName)}</strong> for <strong>${damage.amount}</strong> ${lifepoolTarget} damage${fantastic ? " (Fantastic result)" : ""}. ${esc(targetToken.name)}: ${damage.before} → ${damage.after}.`,
  });
}


function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function mvrpgRollAbility(roll) {
  return roll?.ability ?? roll?.options?.ability ?? "melee";
}

function mvrpgRollLifepoolTarget(roll) {
  const target = roll?.lifepoolTarget ?? roll?.options?.lifepoolTarget ?? "health";
  return target === "focus" ? "focus" : target === "none" ? "none" : "health";
}

function mvrpgMiddleDieValue(roll) {
  try {
    const active = roll?.activeResultDie?.("dieM");
    const total = Number(active?.total);
    if (Number.isFinite(total)) return total;
  } catch (error) {
    console.debug("Danger Room | Could not read active Marvel die", error);
  }

  const die = roll?.dice?.[1];
  const dieTotal = Number(die?.total);
  if (Number.isFinite(dieTotal)) return dieTotal;

  const termTotal = Number(roll?.terms?.[2]?.total ?? roll?.terms?.[1]?.total);
  if (Number.isFinite(termTotal)) return termTotal;
  return 0;
}

function mvrpgFantasticResult(roll) {
  if (typeof roll?.fantasticResult === "boolean") return roll.fantasticResult;
  try {
    return Boolean(roll?.activeResultDie?.("dieM")?.fantasticResult);
  } catch (error) {
    return false;
  }
}

function calculateMvrpgDamageForTarget(roll, attackerActor, targetActor, lifepoolTarget = "health") {
  const abilityKey = mvrpgRollAbility(roll);
  const ability = attackerActor?.system?.abilities?.[abilityKey] ?? {};
  const rank = finiteNumber(attackerActor?.system?.rank);

  // The mvrpg system exposes prepared damageMultiplier/damageModifier values.
  // Exported actor data stores the corresponding Bonus fields instead, so the
  // fallbacks reproduce the system's prepared values if those getters are not
  // available on a synthetic Token Actor.
  const preparedMultiplier = Number(ability.damageMultiplier);
  const multiplier = Number.isFinite(preparedMultiplier)
    ? preparedMultiplier
    : rank + finiteNumber(ability.damageMultiplierBonus);

  const preparedModifier = Number(ability.damageModifier);
  const modifier = Number.isFinite(preparedModifier)
    ? preparedModifier
    : finiteNumber(ability.value) + finiteNumber(ability.damageModifierBonus);

  const resource = targetActor?.system?.lifepool?.[lifepoolTarget] ?? {};
  const resistance = Math.abs(finiteNumber(resource.damageReduction));
  const finalMultiplier = multiplier - resistance;
  const dieM = mvrpgMiddleDieValue(roll);
  let amount = finalMultiplier < 1 ? 0 : dieM * finalMultiplier + modifier;
  if (mvrpgFantasticResult(roll)) amount *= 2;

  return {
    amount: Math.max(0, Math.floor(finiteNumber(amount))),
    dieM,
    multiplier,
    modifier,
    resistance,
    finalMultiplier,
  };
}

async function applyMvrpgDamage({ roll, attackerToken, targetToken, combat, lifepoolTarget, sourceName = "Attack" }) {
  const attackerActor = attackerToken?.actor;
  const targetActor = targetToken?.actor;
  if (!attackerActor || !targetActor) throw new Error("Danger Room could not resolve the attacker or target Actor.");

  const pool = lifepoolTarget === "focus" ? "focus" : "health";
  const resource = targetActor.system?.lifepool?.[pool];
  if (!resource) throw new Error(`${targetToken.name} does not have an MVRPG ${pool} pool.`);

  const damage = calculateMvrpgDamageForTarget(roll, attackerActor, targetActor, pool);
  const before = finiteNumber(resource.value);
  const after = Math.max(0, before - damage.amount);
  const path = `system.lifepool.${pool}.value`;

  await targetActor.update({ [path]: after });

  // Re-read from the Token Actor after the update. This is important for
  // unlinked/synthetic training tokens, whose data lives in the token delta.
  const confirmed = finiteNumber(targetToken.actor?.system?.lifepool?.[pool]?.value);
  if (confirmed !== after) {
    console.warn("Danger Room | Lifepool update did not confirm expected value", {
      target: targetToken.name,
      pool,
      before,
      expected: after,
      confirmed,
      damage,
      sourceName,
    });
  }

  const targetCombatant = combat?.combatants?.find((entry) => entry.tokenId === targetToken.id);
  if (pool === "health" && after <= 0 && targetCombatant && !targetCombatant.defeated) {
    await targetCombatant.update({ defeated: true });
  }

  scheduleOutcomeCheck();
  return { ...damage, before, after: confirmed === after ? confirmed : after };
}

function messageAuthorUser(message) {
  if (message?.author) return message.author;
  const userId = typeof message?.user === "string" ? message.user : message?.user?.id;
  return userId ? game.users.get(userId) : null;
}

function heroTokenForMessage(scene, active, message, user = null) {
  const speakerTokenId = message?.speaker?.token;
  if (speakerTokenId && active.heroTokenIds.includes(speakerTokenId)) return scene.tokens.get(speakerTokenId);

  const speakerActorId = message?.speaker?.actor;
  const assignedId = assignedCharacterId(user);
  return active.heroTokenIds
    .map((id) => scene.tokens.get(id))
    .find((token) => {
      if (!token) return false;
      const actorIds = new Set([token.actorId, token.actor?.id, token.actor?._id].filter(Boolean));
      return (speakerActorId && actorIds.has(speakerActorId)) || (assignedId && actorIds.has(assignedId));
    }) ?? null;
}

function targetedTrainingEnemies(scene, active, user) {
  const enemyIds = new Set(active.enemyTokenIds);
  const found = new Map();

  // Foundry maintains target state on User and Token placeables. Check both so
  // this works reliably when the attack was rolled from another connected client.
  for (const placeable of user?.targets ?? []) {
    const doc = placeable?.document ?? placeable;
    if (doc?.id && enemyIds.has(doc.id) && isConscious(doc)) found.set(doc.id, doc);
  }

  if (canvas.scene?.id === scene.id) {
    for (const id of active.enemyTokenIds) {
      const placeable = canvas.tokens.get(id);
      if (placeable?.targeted?.has?.(user) && isConscious(placeable.document)) {
        found.set(id, placeable.document);
      }
    }
  }

  return Array.from(found.values());
}

async function maybeApplyPlayerAttackDamage(message) {
  if (!isAutomationGM() || runtime.resetting) return;
  if (!isMvrpg()) return;
  if (!message?.rolls?.length) return;
  if (message.getFlag?.(MODULE_ID, "automatedNpcAttack") || message.getFlag?.(MODULE_ID, "automatedResult")) return;

  // mvrpg damage cards contain messageData; the original attack card does not.
  // Skipping damage cards prevents a player from double-applying damage by
  // clicking the system's native damage-calculation icon after Danger Room has
  // already resolved the attack.
  if (message.getFlag?.("mvrpg", "messageData")) return;

  const sceneId = message?.speaker?.scene ?? canvas.scene?.id;
  const scene = game.scenes.get(sceneId) ?? canvas.scene;
  const active = scene?.getFlag(MODULE_ID, FLAG_ACTIVE);
  if (!scene || !active) return;

  const user = messageAuthorUser(message);
  const attackerToken = heroTokenForMessage(scene, active, message, user);
  if (!attackerToken?.actor) return;

  const roll = message.rolls[0];
  const rollType = roll?.type ?? roll?.options?.rollType;
  const lifepoolTarget = mvrpgRollLifepoolTarget(roll);
  if (rollType !== "combat" || lifepoolTarget === "none") return;

  const success = typeof roll?.isSuccess === "boolean"
    ? roll.isSuccess
    : Boolean(roll?.ultimateFantasticResult) || finiteNumber(roll?.finalResults?.total, roll?.total) >= finiteNumber(roll?.tn, roll?.options?.tn, 10);
  if (!success) return;

  let targets = targetedTrainingEnemies(scene, active, user);

  // Convenience for the simplest V1 encounter: if only one conscious training
  // enemy remains, it is unambiguous even if the player forgot to target it.
  if (targets.length === 0) {
    const consciousEnemies = active.enemyTokenIds
      .map((id) => scene.tokens.get(id))
      .filter((token) => token && isConscious(token));
    if (consciousEnemies.length === 1) targets = consciousEnemies;
  }

  if (targets.length !== 1) {
    await ChatMessage.create({
      speaker: { alias: "Danger Room" },
      flags: { [MODULE_ID]: { automatedResult: true } },
      content: `<strong>Danger Room:</strong> ${esc(attackerToken.name)} scored a successful damaging attack, but ${targets.length ? "more than one training enemy is targeted" : "no single training enemy is targeted"}. Target exactly one training opponent and roll the attack again.`,
    });
    return;
  }

  const targetToken = targets[0];
  const combat = game.combats.get(active.combatId) ?? game.combat;
  const sourceName = roll?.item?.name ?? roll?.options?.item?.name ?? "Attack";

  try {
    const damage = await applyMvrpgDamage({
      roll,
      attackerToken,
      targetToken,
      combat,
      lifepoolTarget,
      sourceName,
    });

    await message.setFlag?.(MODULE_ID, "damageApplied", {
      targetTokenId: targetToken.id,
      amount: damage.amount,
      lifepoolTarget,
    });

    await ChatMessage.create({
      speaker: { alias: "Danger Room" },
      flags: { [MODULE_ID]: { automatedResult: true } },
      content: `<strong>Danger Room:</strong> ${esc(attackerToken.name)} deals <strong>${damage.amount}</strong> ${lifepoolTarget} damage to <strong>${esc(targetToken.name)}</strong>. ${esc(targetToken.name)}: ${damage.before} → ${damage.after}.`,
    });
  } catch (error) {
    console.error("Danger Room | Failed to apply player damage", error, { message, attackerToken, targetToken });
    ui.notifications.error(`Danger Room could not apply player damage: ${error.message}`);
  }
}

async function performLegacyMarvelAttack(attackerToken, targetToken, attack, combat) {
  const roll = await attack.roll();
  if (!roll) throw new Error(`${attack.name} did not produce a roll.`);

  const targetActor = targetToken.actor;
  const defenseAbility = attack.system?.attackTarget || attack.system?.ability || "mle";
  const defense = Number(targetActor.system?.abilities?.[defenseAbility]?.defense ?? 10);
  const fantastic = Boolean(roll.isFantastic);
  const hit = fantastic || Number(roll.total ?? 0) >= defense;

  if (!hit) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token: attackerToken.object, actor: attackerToken.actor }),
      content: `<strong>Danger Room:</strong> ${esc(attackerToken.name)} misses ${esc(targetToken.name)} (${esc(attack.name)}: ${roll.total} vs. Defense ${defense}).`,
    });
    return;
  }

  const damage = calculateLegacyDamage(attackerToken.actor, targetActor, attack, roll);
  const damageType = attack.system?.damageType === "focus" ? "focus" : "health";
  const resource = targetActor.system?.[damageType];
  const current = Number(resource?.value ?? 0);
  const newValue = Math.max(-300, current - damage.amount);
  await targetActor.update({ [`system.${damageType}.value`]: newValue });

  const targetCombatant = combat.combatants.find((entry) => entry.tokenId === targetToken.id);
  if (damageType === "health" && newValue <= 0 && targetCombatant && !targetCombatant.defeated) {
    await targetCombatant.update({ defeated: true });
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: attackerToken.object, actor: attackerToken.actor }),
    content: `<strong>Danger Room:</strong> ${esc(attackerToken.name)} hits ${esc(targetToken.name)} with <strong>${esc(attack.name)}</strong> for <strong>${damage.amount}</strong> ${damageType} damage${fantastic ? " (Fantastic success)" : ""}.`,
  });
}

function calculateLegacyDamage(attacker, target, attack, roll) {
  const abilityKey = attack.system?.ability || "mle";
  const ability = attacker.system?.abilities?.[abilityKey] ?? {};
  const multiplier = Number(ability.damageMultiplier ?? attacker.system?.attributes?.rank?.value ?? 0);
  const abilityValue = Number(ability.value ?? 0);
  const damageType = attack.system?.damageType === "focus" ? "focus" : "health";
  const reduction = Number(damageType === "focus" ? target.system?.focusDamageReduction : target.system?.healthDamageReduction) || 0;

  const marvelDie = roll.dice?.find((die) => die?.constructor?.DENOMINATION === "m" || die?.constructor?.name === "MarvelDie");
  const marvelValue = Number(marvelDie?.total ?? 0);
  const effectiveMultiplier = Math.max(0, multiplier - reduction);
  let amount = Math.max(0, marvelValue * effectiveMultiplier + abilityValue);
  if (roll.isFantastic) amount *= 2;

  return { amount: Math.floor(amount), marvelValue, multiplier, reduction, abilityValue };
}

async function checkOutcome(scene) {
  const active = scene.getFlag(MODULE_ID, FLAG_ACTIVE);
  if (!active || runtime.resetting) return false;

  const heroes = active.heroTokenIds.map((id) => scene.tokens.get(id)).filter(Boolean);
  const enemies = active.enemyTokenIds.map((id) => scene.tokens.get(id)).filter(Boolean);
  if (!heroes.length || !enemies.length) return false;

  const enemyKOIds = enemies.filter((token) => !isConscious(token)).map((token) => token.id);
  if (!sameSet(enemyKOIds, active.enemyKOIds ?? [])) {
    await scene.setFlag(MODULE_ID, FLAG_ACTIVE, { ...active, enemyKOIds });
  }

  if (heroes.every((token) => !isConscious(token))) {
    await finishSimulation(scene, "defeat", { healHeroes: true });
    return true;
  }

  if (enemies.every((token) => !isConscious(token))) {
    await finishSimulation(scene, "victory", { healHeroes: false });
    return true;
  }

  return false;
}

async function finishSimulation(scene, outcome, { healHeroes = false } = {}) {
  if (runtime.resetting) return;
  runtime.resetting = true;

  try {
    const active = scene.getFlag(MODULE_ID, FLAG_ACTIVE);
    if (!active) return;
    const config = getConfig(scene);
    const combat = game.combats.get(active.combatId) ?? (game.combat?.id === active.combatId ? game.combat : null);
    const duration = Math.max(0, Date.now() - Number(active.startTime ?? Date.now()));
    const round = Number(combat?.round ?? 0);
    const defeatedCount = new Set(active.enemyKOIds ?? []).size;

    const score = getScore(scene);
    if (outcome === "victory") score.wins += 1;
    if (outcome === "defeat") score.losses += 1;
    if (outcome === "aborted") score.aborts += 1;
    score.enemiesDefeated += outcome === "victory" ? active.enemyTokenIds.length : defeatedCount;
    score.highestRound = Math.max(score.highestRound, round);
    if (outcome === "victory" && (score.bestVictoryMs == null || duration < score.bestVictoryMs)) score.bestVictoryMs = duration;
    score.lastOutcome = outcome === "victory" ? "Victory" : outcome === "defeat" ? "Defeat" : "Aborted";
    score.lastDurationMs = duration;
    await setScore(scene, score);

    if (healHeroes) await restoreHeroes(scene, active.heroTokenIds);
    await resetEnemyTokens(scene, config, { hide: true });

    if (combat?.started) {
      try {
        await combat.endCombat();
      } catch (error) {
        console.warn("Danger Room | Combat could not be ended cleanly", error);
      }
    }

    await scene.unsetFlag(MODULE_ID, FLAG_ACTIVE);

    const timeText = formatDuration(duration);
    if (outcome === "victory") {
      showOverlay("SIMULATION COMPLETE", `Victory in ${timeText} — Round ${round}`);
      await ChatMessage.create({ speaker: { alias: "Danger Room" }, content: `<strong>SIMULATION COMPLETE — VICTORY</strong><br>Time: ${timeText}<br>Round reached: ${round}` });
    } else if (outcome === "defeat") {
      showOverlay("SIMULATION FAILED", `Heroes restored to full health — ${timeText}`);
      await ChatMessage.create({ speaker: { alias: "Danger Room" }, content: `<strong>SIMULATION FAILED</strong><br>Heroes restored to full health.<br>Time survived: ${timeText}<br>Enemies defeated: ${defeatedCount}` });
    } else {
      showOverlay("SIMULATION ABORTED", "Danger Room reset to idle state.");
      await ChatMessage.create({ speaker: { alias: "Danger Room" }, content: `<strong>SIMULATION ABORTED</strong><br>Training room reset.` });
    }
  } finally {
    runtime.resetting = false;
  }
}

async function restoreHeroes(scene, heroIds) {
  for (const id of heroIds) {
    const token = scene.tokens.get(id);
    if (!token?.actor) continue;
    const max = healthMax(token);
    if (max > 0) await token.actor.update({ [healthPath(token.actor)]: max });
  }
}

async function resetEnemyTokens(scene, config, { hide = true } = {}) {
  for (const entry of config.enemies) {
    const token = scene.tokens.get(entry.tokenId);
    if (!token) continue;

    if (token.actor) {
      const updates = {};
      const hpMax = healthMax(token);
      const fpMax = focusMax(token);
      if (hpMax > 0) updates[healthPath(token.actor)] = hpMax;
      if (fpMax > 0) updates[focusPath(token.actor)] = fpMax;
      if (Object.keys(updates).length) await token.actor.update(updates);
    }

    await token.update({
      x: entry.spawn?.x ?? token.x,
      y: entry.spawn?.y ?? token.y,
      elevation: entry.spawn?.elevation ?? token.elevation,
      rotation: entry.spawn?.rotation ?? token.rotation,
      hidden: hide,
    });
  }
}

async function recoverOrPrepareScene(scene) {
  const config = getConfig(scene);
  const active = scene.getFlag(MODULE_ID, FLAG_ACTIVE);
  if (active) {
    const combat = game.combats.get(active.combatId);
    if (combat?.started) {
      scheduleTurnProcessing(400);
      return;
    }
    await scene.unsetFlag(MODULE_ID, FLAG_ACTIVE);
  }
  if (config.enabled) await resetEnemyTokens(scene, config, { hide: true });
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((value) => bs.has(value));
}

function formatDuration(ms) {
  if (ms == null) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function showOverlay(title, subtitle) {
  document.getElementById("danger-room-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "danger-room-overlay";
  overlay.innerHTML = `<div class="dr-overlay-panel"><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 4200);
}

function showScoreboard(scene) {
  if (!scene) return;
  const score = getScore(scene);
  const content = `
    <div class="danger-room-scoreboard">
      <div class="dr-stat">Simulations<strong>${score.simulations}</strong></div>
      <div class="dr-stat">Wins / Losses<strong>${score.wins} / ${score.losses}</strong></div>
      <div class="dr-stat">Aborted<strong>${score.aborts}</strong></div>
      <div class="dr-stat">Enemies Defeated<strong>${score.enemiesDefeated}</strong></div>
      <div class="dr-stat">Highest Round<strong>${score.highestRound}</strong></div>
      <div class="dr-stat">Best Victory<strong>${formatDuration(score.bestVictoryMs)}</strong></div>
      <div class="dr-stat">Last Result<strong>${esc(score.lastOutcome)}</strong></div>
      <div class="dr-stat">Last Duration<strong>${formatDuration(score.lastDurationMs)}</strong></div>
    </div>`;

  new Dialog({
    title: `Danger Room Scoreboard — ${scene.name}`,
    content,
    buttons: { close: { label: "Close" } },
    default: "close",
  }, { width: 520 }).render(true);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
