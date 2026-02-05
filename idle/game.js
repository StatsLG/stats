// ==========================
// Idle Capture — MVP
// - More rarity tiers
// - Whole-number damage + display
// - Pity system (guarantees Rare/Epic/Legendary+ on streaks)
// - Nerfed stage scaling (much less explosive)
// ==========================

const SAVE_KEY = "idle_capture_save_v1";
const SAVE_VERSION = 2; // bumped because we added pity fields

const SPAWN_DURATION = 60.0;   // seconds per spawn
const OFFLINE_CAP_SECONDS = 8 * 60 * 60; // 8 hours

// ---- Rarity weights (baseline odds) ----
// Higher = more common.
const RARITY_WEIGHTS = {
  Common: 700,
  Uncommon: 220,
  Rare: 70,
  Epic: 9,
  Legendary: 1,
  Mythic: 0.3,
  Ancient: 0.1,
  Cosmic: 0.03
};

// ---- Rarity multipliers for HP + rewards ----
// Nerfed high-tier multipliers a bit (the stage scaling was the real culprit, but this helps too)
const RARITY_MULT = {
  Common:     { hp: 1.0,  coins: 1.0 },
  Uncommon:   { hp: 1.2,  coins: 1.4 },
  Rare:       { hp: 1.6,  coins: 2.2 },
  Epic:       { hp: 2.1,  coins: 3.3 },
  Legendary:  { hp: 3.0,  coins: 6.0 },
  Mythic:     { hp: 4.2,  coins: 10.0 },
  Ancient:    { hp: 6.0,  coins: 18.0 },
  Cosmic:     { hp: 8.0,  coins: 35.0 }
};

// ---- Pity thresholds (tune these) ----
// If you go this many spawns without >= that rarity, your next spawn is forced.
const PITY = {
  rarePlusAfter: 12,        // force Rare+ if no Rare/Epic/Legendary/Mythic/Ancient/Cosmic in 12 spawns
  epicPlusAfter: 35,        // force Epic+ if no Epic+ in 35 spawns
  legendaryPlusAfter: 120,  // force Legendary+ if no Legendary+ in 120 spawns
  mythicPlusAfter: 260      // force Mythic+ if no Mythic+ in 260 spawns
  // You can add Ancient/Cosmic pity too, but those are usually “ultra chase”
};

// ---- Creature pool (add tons here) ----
// Each capture gives +attackBonus.
const CREATURES = [
  // Common
  { id:"slime", name:"Green Slime", rarity:"Common", baseHP:18, attackBonus:1 },
  { id:"rat", name:"Tunnel Rat", rarity:"Common", baseHP:22, attackBonus:1 },
  { id:"sprout", name:"Angry Sprout", rarity:"Common", baseHP:25, attackBonus:1 },
  { id:"moth", name:"Lantern Moth", rarity:"Common", baseHP:28, attackBonus:1 },

  // Uncommon
  { id:"goblin", name:"Goblin Skirmisher", rarity:"Uncommon", baseHP:40, attackBonus:3 },
  { id:"boar", name:"Ridge Boar", rarity:"Uncommon", baseHP:46, attackBonus:3 },
  { id:"wisp", name:"Blue Wisp", rarity:"Uncommon", baseHP:52, attackBonus:4 },

  // Rare
  { id:"ogre", name:"Moss Ogre", rarity:"Rare", baseHP:90, attackBonus:10 },
  { id:"wyvern", name:"Glass Wyvern", rarity:"Rare", baseHP:110, attackBonus:12 },
  { id:"siren", name:"River Siren", rarity:"Rare", baseHP:120, attackBonus:13 },

  // Epic
  { id:"lich", name:"Lich of the Library", rarity:"Epic", baseHP:220, attackBonus:30 },
  { id:"behemoth", name:"Crater Behemoth", rarity:"Epic", baseHP:260, attackBonus:35 },
  { id:"archon", name:"Storm Archon", rarity:"Epic", baseHP:280, attackBonus:38 },

  // Legendary
  { id:"phoenix", name:"Ashen Phoenix", rarity:"Legendary", baseHP:520, attackBonus:90 },
  { id:"leviathan", name:"Dusk Leviathan", rarity:"Legendary", baseHP:620, attackBonus:110 },

  // Mythic
  { id:"seraph", name:"Clockwork Seraph", rarity:"Mythic", baseHP:1100, attackBonus:220 },
  { id:"hydra", name:"Iron Hydra", rarity:"Mythic", baseHP:1250, attackBonus:260 },

  // Ancient
  { id:"titan", name:"Ancient Titan", rarity:"Ancient", baseHP:2400, attackBonus:520 },
  { id:"wyrm", name:"First Wyrm", rarity:"Ancient", baseHP:2800, attackBonus:650 },

  // Cosmic
  { id:"voidking", name:"Void-King", rarity:"Cosmic", baseHP:7000, attackBonus:1600 },
  { id:"starforged", name:"Starforged Colossus", rarity:"Cosmic", baseHP:9000, attackBonus:2200 }
];

// Rarity ordering helpers (for pity checks)
const RARITY_ORDER = ["Common","Uncommon","Rare","Epic","Legendary","Mythic","Ancient","Cosmic"];
const rarityRank = (r) => RARITY_ORDER.indexOf(r);
const isAtLeast = (r, min) => rarityRank(r) >= rarityRank(min);

// ---- Game state ----
let state = defaultState();
let current = null;
let timeLeft = SPAWN_DURATION;

// ---- UI ----
const $ = (id) => document.getElementById(id);
const ui = {
  coins: $("coins"),
  atk: $("atk"),
  dps: $("dps"),
  clickDmg: $("clickDmg"),
  spawnName: $("spawnName"),
  spawnRarity: $("spawnRarity"),
  timeLeft: $("timeLeft"),
  hpNow: $("hpNow"),
  hpMax: $("hpMax"),
  hpFill: $("hpFill"),
  log: $("log"),
  capturesList: $("capturesList"),
  saveBox: $("saveBox"),

  buyAtk: $("buyAtk"),
  buyPassive: $("buyPassive"),
  buyClick: $("buyClick"),
  costAtk: $("costAtk"),
  costPassive: $("costPassive"),
  costClick: $("costClick"),

  attackBtn: $("attackBtn"),
  skipBtn: $("skipBtn"),

  exportBtn: $("exportBtn"),
  importBtn: $("importBtn"),
  resetBtn: $("resetBtn"),
};

function defaultState(){
  return {
    version: SAVE_VERSION,
    coins: 0,
    stage: 0,

    baseAttack: 1,
    passiveMult: 0.30,
    clickMult:  1.00,

    costs: { atk: 10, passive: 25, click: 25 },
    captures: {},

    // pity counters (spawns since last >= tier)
    pity: {
      sinceRarePlus: 0,
      sinceEpicPlus: 0,
      sinceLegendaryPlus: 0,
      sinceMythicPlus: 0
    },

    lastSave: Date.now()
  };
}

// ---- Derived stats ----
function getCapturePower(){
  let total = 0;
  for (const [id, count] of Object.entries(state.captures)) {
    const c = CREATURES.find(x => x.id === id);
    if (c) total += (c.attackBonus || 0) * count;
  }
  return total;
}
function getAttackBasePlusCaptures(){
  return state.baseAttack + getCapturePower();
}
function getPassiveDPS(){
  return Math.round(getAttackBasePlusCaptures() * state.passiveMult);
}
function getClickDamage(){
  return Math.round(getAttackBasePlusCaptures() * state.clickMult);
}

// ---- Weighted selection ----
function weightedPick(map){
  const entries = Object.entries(map);
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = Math.random() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

// ---- Pity logic: decide minimum rarity for next spawn ----
function getForcedMinRarity(){
  // check from strongest guarantee down to weakest
  if (state.pity.sinceMythicPlus >= PITY.mythicPlusAfter) return "Mythic";
  if (state.pity.sinceLegendaryPlus >= PITY.legendaryPlusAfter) return "Legendary";
  if (state.pity.sinceEpicPlus >= PITY.epicPlusAfter) return "Epic";
  if (state.pity.sinceRarePlus >= PITY.rarePlusAfter) return "Rare";
  return null;
}

// pick rarity normally, but apply forced minimum if pity triggers
function pickRarityWithPity(){
  const forcedMin = getForcedMinRarity();
  if (!forcedMin) return { rarity: weightedPick(RARITY_WEIGHTS), forced: null };

  // force at least the min rarity: choose from [min..top] using their baseline weights
  const allowed = {};
  for (const [r, w] of Object.entries(RARITY_WEIGHTS)) {
    if (isAtLeast(r, forcedMin)) allowed[r] = w;
  }
  const picked = weightedPick(allowed);
  return { rarity: picked, forced: forcedMin };
}

// update pity counters after we actually spawn a rarity
function updatePityAfterSpawn(spawnRarity){
  // increment all streak counters first
  state.pity.sinceRarePlus += 1;
  state.pity.sinceEpicPlus += 1;
  state.pity.sinceLegendaryPlus += 1;
  state.pity.sinceMythicPlus += 1;

  // reset counters if the rarity meets the tier
  if (isAtLeast(spawnRarity, "Rare")) state.pity.sinceRarePlus = 0;
  if (isAtLeast(spawnRarity, "Epic")) state.pity.sinceEpicPlus = 0;
  if (isAtLeast(spawnRarity, "Legendary")) state.pity.sinceLegendaryPlus = 0;
  if (isAtLeast(spawnRarity, "Mythic")) state.pity.sinceMythicPlus = 0;
}

// ---- Nerfed stage scaling ----
// Old: 1.15^stage (explodes)
// New: gentle exponential + soft cap on stage contribution
function getStageScale(){
  const effectiveStage = Math.min(state.stage, 250); // safety cap so it never goes insane
  return Math.pow(1.06, effectiveStage); // tune: 1.04 (slower) .. 1.08 (faster)
}

function pickCreature(){
  const { rarity, forced } = pickRarityWithPity();

  const pool = CREATURES.filter(c => c.rarity === rarity);
  const list = pool.length ? pool : CREATURES;
  const base = list[Math.floor(Math.random() * list.length)];

  const mult = RARITY_MULT[base.rarity] || { hp:1, coins:1 };
  const stageScale = getStageScale();

  // HP and reward
  const hpMax = Math.max(1, Math.round(base.baseHP * mult.hp * stageScale));

  // reward scaling nerf: was (1 + stage*0.03) which grows forever
  // now use a softer curve: grows early, then slows
  const rewardScale = 1 + Math.sqrt(state.stage) * 0.08; // tune: 0.05..0.12
  const coinsReward = Math.max(1, Math.round(5 * mult.coins * rewardScale));

  const spawn = { ...base, hpMax, hp: hpMax, coinsReward };

  updatePityAfterSpawn(spawn.rarity);

  // If this spawn was forced by pity, you can message it (optional):
  if (forced) spawn.pityNote = `Pity triggered: guaranteed ${forced}+`;

  return spawn;
}

// ---- Spawn control ----
function startNewSpawn(){
  current = pickCreature();
  timeLeft = SPAWN_DURATION;

  const note = current.pityNote ? ` <span class="muted">(${current.pityNote})</span>` : "";
  logLine(`A wild <b>${current.name}</b> appeared! (${current.rarity})${note}`);
  render();
}
function skipSpawn(){
  logLine(`You skipped <b>${current?.name ?? "the spawn"}</b>.`);
  startNewSpawn();
}

// ---- Combat ----
function dealDamage(amount){
  if (!current) return;
  const dmg = Math.max(0, Math.round(amount));
  if (dmg === 0) return;

  current.hp = Math.max(0, current.hp - dmg);
  if (current.hp === 0) defeatCurrent();
}

function defeatCurrent(){
  if (!current) return;

  state.captures[current.id] = (state.captures[current.id] || 0) + 1;
  state.coins += current.coinsReward;
  state.stage += 1;

  logLine(
    `Defeated and captured <b>${current.name}</b>! ` +
    `+${current.coinsReward} coins, +${current.attackBonus} power (capture bonus).`
  );

  startNewSpawn();
}

// ---- Upgrades ----
function canAfford(cost){ return state.coins >= cost; }
function spend(cost){ state.coins -= cost; }

function buyAttack(){
  const cost = state.costs.atk;
  if (!canAfford(cost)) return logLine(`Not enough coins for Attack upgrade.`);
  spend(cost);
  state.baseAttack += 1;
  state.costs.atk = Math.round(cost * 1.30 + 2); // slightly nerfed growth
  logLine(`Base Attack increased to <b>${state.baseAttack}</b>.`);
  render();
}
function buyPassive(){
  const cost = state.costs.passive;
  if (!canAfford(cost)) return logLine(`Not enough coins for Passive upgrade.`);
  spend(cost);
  state.passiveMult = +(state.passiveMult + 0.10).toFixed(2);
  state.costs.passive = Math.round(cost * 1.35 + 5); // slightly nerfed growth
  logLine(`Passive multiplier increased to <b>${state.passiveMult.toFixed(2)}x</b>.`);
  render();
}
function buyClick(){
  const cost = state.costs.click;
  if (!canAfford(cost)) return logLine(`Not enough coins for Click upgrade.`);
  spend(cost);
  state.clickMult = +(state.clickMult + 0.10).toFixed(2);
  state.costs.click = Math.round(cost * 1.35 + 5); // slightly nerfed growth
  logLine(`Click multiplier increased to <b>${state.clickMult.toFixed(2)}x</b>.`);
  render();
}

// ---- Save / Load ----
function save(){
  state.lastSave = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}
function load(){
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  try{
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return false;

    // migrate older saves that don't have pity
    const merged = { ...defaultState(), ...data };
    if (!merged.pity) merged.pity = defaultState().pity;
    if (merged.version !== SAVE_VERSION) merged.version = SAVE_VERSION;

    state = merged;
    return true;
  }catch{
    return false;
  }
}
function exportSave(){
  save();
  ui.saveBox.value = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
  logLine("Save exported. Copy the text from the box.");
}
function importSave(){
  try{
    const txt = ui.saveBox.value.trim();
    if (!txt) return logLine("Paste a save string first.");
    const json = decodeURIComponent(escape(atob(txt)));
    const data = JSON.parse(json);

    const merged = { ...defaultState(), ...data };
    if (!merged.pity) merged.pity = defaultState().pity;
    merged.version = SAVE_VERSION;

    state = merged;
    save();
    logLine("Save imported!");
    startNewSpawn();
  }catch{
    logLine("Import failed. That save string doesn't look valid.");
  }
}
function resetAll(){
  if (!confirm("Reset all progress?")) return;
  state = defaultState();
  localStorage.removeItem(SAVE_KEY);
  logLine("Progress reset.");
  startNewSpawn();
}

// ---- Offline progress ----
function applyOfflineProgress(){
  const now = Date.now();
  const elapsed = Math.floor((now - (state.lastSave || now)) / 1000);
  const capped = Math.max(0, Math.min(elapsed, OFFLINE_CAP_SECONDS));
  if (capped <= 2) return;

  const dps = getPassiveDPS();
  const coinsPerSecond = dps * 0.03; // nerfed from 0.05
  const gained = Math.floor(coinsPerSecond * capped);

  if (gained > 0){
    state.coins += gained;
    logLine(`Offline gains: +<b>${gained}</b> coins for ${capped}s away.`);
  }else{
    logLine(`Welcome back! (Away ${capped}s)`);
  }
}

// ---- Rendering ----
function rarityBadge(r){
  ui.spawnRarity.textContent = r || "—";
  const color =
    r === "Common" ? "rgba(255,255,255,0.10)" :
    r === "Uncommon" ? "rgba(46,229,157,0.18)" :
    r === "Rare" ? "rgba(90,168,255,0.18)" :
    r === "Epic" ? "rgba(178,102,255,0.18)" :
    r === "Legendary" ? "rgba(255,210,90,0.18)" :
    r === "Mythic" ? "rgba(255,90,200,0.18)" :
    r === "Ancient" ? "rgba(255,120,60,0.18)" :
    r === "Cosmic" ? "rgba(150,255,255,0.18)" :
    "rgba(255,255,255,0.10)";
  ui.spawnRarity.style.background = color;
}

function renderCaptures(){
  const entries = Object.entries(state.captures)
    .map(([id, count]) => {
      const c = CREATURES.find(x => x.id === id);
      if (!c) return null;
      return { name: c.name, rarity: c.rarity, count, bonus: c.attackBonus };
    })
    .filter(Boolean)
    .sort((a,b) => b.count - a.count);

  if (entries.length === 0){
    ui.capturesList.innerHTML = `<div class="muted">No captures yet.</div>`;
    return;
  }

  ui.capturesList.innerHTML = entries.map(e => `
    <div class="capRow">
      <div>
        <div><strong>${e.name}</strong> <span class="muted">(${e.rarity})</span></div>
        <div class="muted">+${e.bonus} power each</div>
      </div>
      <div><strong>x${e.count}</strong></div>
    </div>
  `).join("");
}

function render(){
  ui.coins.textContent = String(state.coins);
  ui.atk.textContent = String(Math.round(getAttackBasePlusCaptures()));
  ui.dps.textContent = String(getPassiveDPS());
  ui.clickDmg.textContent = String(getClickDamage());

  ui.costAtk.textContent = state.costs.atk;
  ui.costPassive.textContent = state.costs.passive;
  ui.costClick.textContent = state.costs.click;

  if (current){
    ui.spawnName.textContent = current.name;
    rarityBadge(current.rarity);

    ui.timeLeft.textContent = `${timeLeft.toFixed(1)}s`;
    ui.hpNow.textContent = current.hp;
    ui.hpMax.textContent = current.hpMax;

    const pct = current.hpMax ? (current.hp / current.hpMax) * 100 : 0;
    ui.hpFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  renderCaptures();
}

function logLine(html){
  ui.log.innerHTML = html;
}

// ---- Main loop ----
let lastTick = performance.now();
let autosaveCounter = 0;

function tick(now){
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  // passive damage (whole-number per tick)
  const dmg = Math.round(getPassiveDPS() * dt);
  dealDamage(dmg);

  timeLeft -= dt;
  if (timeLeft <= 0){
    if (current && current.hp > 0){
      const consolation = Math.max(1, Math.floor(current.coinsReward * 0.15));
      state.coins += consolation;
      logLine(`Time! <b>${current.name}</b> escaped. +${consolation} consolation coins.`);
    }
    startNewSpawn();
  }

  autosaveCounter += dt;
  if (autosaveCounter >= 5){
    autosaveCounter = 0;
    save();
  }

  render();
  requestAnimationFrame(tick);
}

// ---- Events ----
ui.attackBtn.addEventListener("click", () => {
  dealDamage(getClickDamage());
  render();
});
ui.skipBtn.addEventListener("click", skipSpawn);

ui.buyAtk.addEventListener("click", buyAttack);
ui.buyPassive.addEventListener("click", buyPassive);
ui.buyClick.addEventListener("click", buyClick);

ui.exportBtn.addEventListener("click", exportSave);
ui.importBtn.addEventListener("click", importSave);
ui.resetBtn.addEventListener("click", resetAll);

// ---- Boot ----
(function init(){
  const loaded = load();
  if (loaded) applyOfflineProgress();
  else logLine("Welcome! Click Attack to start capturing.");

  startNewSpawn();
  save();
  requestAnimationFrame(tick);
})();
