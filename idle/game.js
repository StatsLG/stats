// ==========================
// Idle Capture — MVP
// Spawn every 60 seconds
// Passive DPS + click damage
// Captures add flat power
// Autosave + export/import + simple offline gains
// ==========================

const SAVE_KEY = "idle_capture_save_v1";
const SAVE_VERSION = 1;

const TICK_MS = 100;           // simulation tick
const SPAWN_DURATION = 60.0;   // seconds per spawn
const OFFLINE_CAP_SECONDS = 8 * 60 * 60; // 8 hours

// ---- Rarity weights (tune these) ----
const RARITY_WEIGHTS = {
  Common: 700,
  Uncommon: 220,
  Rare: 70,
  Epic: 9,
  Legendary: 1
};

// ---- Creature pool (add tons here) ----
// Each capture gives +attackBonus (MVP design choice).
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

  // Epic
  { id:"lich", name:"Lich of the Library", rarity:"Epic", baseHP:220, attackBonus:30 },
  { id:"behemoth", name:"Crater Behemoth", rarity:"Epic", baseHP:260, attackBonus:35 },

  // Legendary
  { id:"phoenix", name:"Ashen Phoenix", rarity:"Legendary", baseHP:520, attackBonus:90 }
];

// Optional: rarity multipliers for HP + rewards
const RARITY_MULT = {
  Common:     { hp: 1.0, coins: 1.0 },
  Uncommon:   { hp: 1.3, coins: 1.5 },
  Rare:       { hp: 1.8, coins: 2.5 },
  Epic:       { hp: 2.6, coins: 4.0 },
  Legendary:  { hp: 4.0, coins: 8.0 }
};

// ---- Game state ----
let state = defaultState();
let current = null; // current spawn object (expanded)
let timeLeft = SPAWN_DURATION;

// ---- UI refs ----
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

// ---- Defaults ----
function defaultState(){
  return {
    version: SAVE_VERSION,
    coins: 0,
    stage: 0,

    baseAttack: 1,
    passiveMult: 0.30, // passive DPS = (base + capturePower) * passiveMult
    clickMult:  1.00,  // click dmg  = (base + capturePower) * clickMult

    // costs + scaling
    costs: {
      atk: 10,
      passive: 25,
      click: 25
    },

    // captures as { creatureId: count }
    captures: {},

    // timestamps
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
  return getAttackBasePlusCaptures() * state.passiveMult;
}
function getClickDamage(){
  return getAttackBasePlusCaptures() * state.clickMult;
}

// ---- Rarity selection ----
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

function pickCreature(){
  const rarity = weightedPick(RARITY_WEIGHTS);
  const pool = CREATURES.filter(c => c.rarity === rarity);
  // Fallback if your table is unbalanced
  const list = pool.length ? pool : CREATURES;
  const base = list[Math.floor(Math.random() * list.length)];

  const mult = RARITY_MULT[base.rarity] || { hp:1, coins:1 };
  const stageScale = Math.pow(1.15, state.stage); // tune progression here

  const hpMax = Math.round(base.baseHP * mult.hp * stageScale);
  const coinsReward = Math.round(5 * mult.coins * (1 + state.stage * 0.03)); // tune reward here

  return {
    ...base,
    hpMax,
    hp: hpMax,
    coinsReward
  };
}

// ---- Spawn control ----
function startNewSpawn(){
  current = pickCreature();
  timeLeft = SPAWN_DURATION;
  logLine(`A wild <b>${current.name}</b> appeared! (${current.rarity})`);
  render();
}

function skipSpawn(){
  logLine(`You skipped <b>${current?.name ?? "the spawn"}</b>.`);
  startNewSpawn();
}

// ---- Combat ----
function dealDamage(amount){
  if (!current) return;
  current.hp = Math.max(0, current.hp - amount);
  if (current.hp === 0){
    defeatCurrent();
  }
}

function defeatCurrent(){
  if (!current) return;

  // capture
  state.captures[current.id] = (state.captures[current.id] || 0) + 1;

  // reward coins
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
  state.costs.atk = Math.round(cost * 1.35 + 2);
  logLine(`Base Attack increased to <b>${state.baseAttack}</b>.`);
  render();
}

function buyPassive(){
  const cost = state.costs.passive;
  if (!canAfford(cost)) return logLine(`Not enough coins for Passive upgrade.`);
  spend(cost);
  state.passiveMult = +(state.passiveMult + 0.10).toFixed(2);
  state.costs.passive = Math.round(cost * 1.45 + 5);
  logLine(`Passive multiplier increased to <b>${state.passiveMult.toFixed(2)}x</b>.`);
  render();
}

function buyClick(){
  const cost = state.costs.click;
  if (!canAfford(cost)) return logLine(`Not enough coins for Click upgrade.`);
  spend(cost);
  state.clickMult = +(state.clickMult + 0.10).toFixed(2);
  state.costs.click = Math.round(cost * 1.45 + 5);
  logLine(`Click multiplier increased to <b>${state.clickMult.toFixed(2)}x</b>.`);
  render();
}

// ---- Saving / Loading ----
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

    // minimal validation/migration hook
    if (data.version !== SAVE_VERSION){
      // You can migrate old versions here later
      // For now, accept if close enough
    }
    state = { ...defaultState(), ...data };
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
    state = { ...defaultState(), ...data };
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

// ---- Offline progress (simple + safe) ----
// This MVP just gives coins from passive DPS over time.
// Later we can simulate spawn cycles more realistically.
function applyOfflineProgress(){
  const now = Date.now();
  const elapsed = Math.floor((now - (state.lastSave || now)) / 1000);
  const capped = Math.max(0, Math.min(elapsed, OFFLINE_CAP_SECONDS));
  if (capped <= 2) return;

  // Example: convert passive DPS into coins slowly
  const dps = getPassiveDPS();
  const coinsPerSecond = dps * 0.05; // tune this
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
  ui.coins.textContent = state.coins.toString();
  ui.atk.textContent = getAttackBasePlusCaptures().toFixed(1);
  ui.dps.textContent = getPassiveDPS().toFixed(2);
  ui.clickDmg.textContent = getClickDamage().toFixed(2);

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

// ---- Log ----
function logLine(html){
  ui.log.innerHTML = html;
}

// ---- Main loop ----
let lastTick = performance.now();
function tick(now){
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  // passive damage
  const dmg = getPassiveDPS() * dt;
  dealDamage(dmg);

  // time countdown
  timeLeft -= dt;
  if (timeLeft <= 0){
    // spawn ends
    if (current && current.hp > 0){
      // consolation reward
      const consolation = Math.max(1, Math.floor(current.coinsReward * 0.15));
      state.coins += consolation;
      logLine(`Time! <b>${current.name}</b> escaped. +${consolation} consolation coins.`);
    }
    startNewSpawn();
  }

  // autosave periodically
  autosaveCounter += dt;
  if (autosaveCounter >= 5){
    autosaveCounter = 0;
    save();
  }

  render();
  requestAnimationFrame(tick);
}
let autosaveCounter = 0;

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
  if (loaded) {
    applyOfflineProgress();
  } else {
    logLine("Welcome! Click Attack to start capturing.");
  }
  startNewSpawn();
  save();
  requestAnimationFrame(tick);
})();
