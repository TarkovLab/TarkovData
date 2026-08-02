#!/usr/bin/env node
/**
 * Job: build the full quest catalog for TarkovLab.
 *
 * Consumes:
 *   - maps/quests.json — the raw quest catalog (source: json.tarkov.dev
 *     regular/tasks) with 501 quests, each with objectives and per-map
 *     locations already projected onto the SVG maps (xPct/yPct, world
 *     coordinates, outlines).
 *
 * Produces data/quests.json — the catalog served by tarkovlab-api:
 *   - id: slug (normalized name, e.g. "shooting-cans") — used in the
 *     /quests/:id URLs and as the stable public identifier
 *   - gameId: the original game object id (hex string)
 *   - name: clean display name (same style as achievements.json)
 *   - antifandomLink: mirrored from the fandom wiki link
 *   - imageLink: banner on https://assets.tarkovlab.org/quests/<name>.webp,
 *     verified with a HEAD request (null when the asset is missing)
 *   - everything else is preserved: trader, map, level, kappa, rewards,
 *     wiki link, and the full objectives with their map locations.
 *
 *   node jobs/build_quests.js
 *   MAPS_DIR=../maps node jobs/build_quests.js
 *
 * Quest rewards (items, trader standing) are enriched from
 * jobs/raw/pve_tasks.json (source: json.tarkov.dev pve/tasks), matched by
 * normalizedName; reward items are resolved to catalog slugs via
 * data/items.json.
 */
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const MAPS_DIR = path.resolve(process.env.MAPS_DIR || path.join(ROOT, '..', 'maps'));
const OUT_FILE = path.join(ROOT, 'data', 'quests.json');
const BANNER_CACHE_FILE = path.join(HERE, 'raw', 'quest_banner_check.json');
const RAW_TASKS_FILE = path.join(HERE, 'raw', 'pve_tasks.json');
const ITEMS_FILE = path.join(ROOT, 'data', 'items.json');
const TRADERS_FILE = path.join(ROOT, 'data', 'traders.json');
const HIDEOUT_FILE = path.join(ROOT, 'data', 'hideout.json');
const ASSETS_ORIGIN = 'https://assets.tarkovlab.org/quests';

function questAssetName(name) {
  return String(name || '')
    .toLowerCase()
    .split(' - ')
    .map((part) =>
      part
        .replace(/['’`.!?/"]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    )
    .join('__');
}

function antifandomLink(wiki) {
  if (!wiki) return null;
  return wiki.replace('escapefromtarkov.fandom.com/wiki/', 'antifandom.com/escapefromtarkov/wiki/');
}

// Map of trader gameId -> trader slug id (e.g. "54cb57776803fa99248b456e" -> "prapor")
function buildTraderGameIdMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(TRADERS_FILE, 'utf8'));
    const traders = Array.isArray(raw) ? raw : raw.traders || [];
    const map = new Map();
    for (const t of traders) {
      if (t.gameId) map.set(t.gameId, t.id || t.gameId);
    }
    return map;
  } catch {
    return new Map();
  }
}

// Map of hideout station gameId -> station slug id (e.g. "5d484fda654e7600681d9315" -> "workbench")
function buildStationGameIdMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(HIDEOUT_FILE, 'utf8'));
    const stations = Array.isArray(raw) ? raw : raw.stations || [];
    const map = new Map();
    for (const s of stations) {
      if (s.gameId) map.set(s.gameId, s.id || s.gameId);
    }
    return map;
  } catch {
    return new Map();
  }
}

// Map of item gameId -> item slug id (e.g. "5aafbcd986f7745e590fff23" -> "medicine-case")
function buildItemGameIdMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8'));
    const items = Array.isArray(raw) ? raw : raw.items || [];
    const map = new Map();
    for (const it of items) {
      if (it.gameId) map.set(it.gameId, it.id || it.gameId);
    }
    return map;
  } catch {
    return new Map();
  }
}

function normalizeQuestId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Enrich quests with start/finish rewards from jobs/raw/pve_tasks.json.
function enrichQuestsWithRewards(quests) {
  if (!fs.existsSync(RAW_TASKS_FILE)) {
    console.log('[build_quests] raw tasks file missing, skipping reward enrichment');
    return quests;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(RAW_TASKS_FILE, 'utf8'));
  } catch {
    console.log('[build_quests] failed to parse raw tasks, skipping reward enrichment');
    return quests;
  }
  const tasksDict = raw && raw.data && raw.data.tasks;
  if (!tasksDict || typeof tasksDict !== 'object') {
    console.log('[build_quests] unexpected raw tasks format, skipping reward enrichment');
    return quests;
  }

  const itemIds = buildItemGameIdMap();
  const traderIds = buildTraderGameIdMap();
  const stationIds = buildStationGameIdMap();

  const byNorm = new Map();
  for (const q of quests) byNorm.set(q.id, q);

  function resolveRewardItems(entries) {
    const items = [];
    for (const e of entries || []) {
      if (!e || !e.item) continue;
      const id = itemIds.get(e.item) || e.item;
      const count = e.count != null ? e.count : 1;
      items.push({ item: id, count });
    }
    return items;
  }

  function resolveTraderStanding(entries) {
    const out = [];
    for (const e of entries || []) {
      if (!e || e.trader == null || e.standing == null) continue;
      out.push({ trader: traderIds.get(e.trader) || e.trader, standing: e.standing });
    }
    return out;
  }

  function resolveCraftUnlocks(entries) {
    const out = [];
    for (const e of entries || []) {
      if (!e || !e.item) continue;
      out.push({
        station: stationIds.get(e.station) || e.station || null,
        level: e.level != null ? e.level : 1,
        item: itemIds.get(e.item) || e.item,
        count: e.count != null ? e.count : 1,
      });
    }
    return out;
  }

  function resolveTraderUnlocks(entries) {
    const out = [];
    for (const e of entries || []) {
      if (!e || !e.item) continue;
      out.push({
        id: e.id || null,
        level: e.level != null ? e.level : 1,
        item: itemIds.get(e.item) || e.item,
        count: e.count != null ? e.count : 1,
        trader: traderIds.get(e.trader) || e.trader || null,
      });
    }
    return out;
  }

  function resolveSkillLevelRewards(entries) {
    const out = [];
    for (const e of entries || []) {
      if (!e || !e.skill) continue;
      out.push({ skill: e.skill, level: e.level != null ? e.level : 1 });
    }
    return out;
  }

  let enriched = 0;
  for (const task of Object.values(tasksDict)) {
    const quest = byNorm.get(normalizeQuestId(task.normalizedName)) || byNorm.get(normalizeQuestId(task.name));
    if (!quest) continue;
    const finish = task.finishRewards || {};
    const start = task.startRewards || {};
    quest.startRewards = {
      items: resolveRewardItems(start.items),
      traderStanding: resolveTraderStanding(start.traderStanding),
      craftUnlocks: resolveCraftUnlocks(start.craftUnlock),
      traderUnlocks: resolveTraderUnlocks(start.offerUnlock),
      skillLevelRewards: resolveSkillLevelRewards(start.skillLevelReward),
    };
    quest.finishRewards = {
      items: resolveRewardItems(finish.items),
      traderStanding: resolveTraderStanding(finish.traderStanding),
      craftUnlocks: resolveCraftUnlocks(finish.craftUnlock),
      traderUnlocks: resolveTraderUnlocks(finish.offerUnlock),
      skillLevelRewards: resolveSkillLevelRewards(finish.skillLevelReward),
    };
    enriched++;
  }
  console.log(`[build_quests] rewards enriched for ${enriched}/${quests.length} quests`);
  return quests;
}

async function verifyBanners(quests) {
  const cache = fs.existsSync(BANNER_CACHE_FILE)
    ? JSON.parse(fs.readFileSync(BANNER_CACHE_FILE, 'utf8'))
    : {};
  const pending = quests.filter((q) => q.imageLink && !(q.imageLink in cache));
  let checked = 0;
  let found = 0;
  const CONCURRENCY = 6;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (q) => {
        try {
          const res = await fetch(q.imageLink, { method: 'HEAD' });
          cache[q.imageLink] = res.ok;
        } catch {
          cache[q.imageLink] = null; // network issue: keep the generated link
        }
        checked++;
        if (cache[q.imageLink] === true) found++;
      })
    );
  }
  const before = new Set(Object.keys(cache));
  if (checked > 0) {
    fs.writeFileSync(BANNER_CACHE_FILE, JSON.stringify(cache, null, 2) + '\n');
  }
  const confirmed = quests.filter((q) => cache[q.imageLink] === true).length;
  const missing = quests.filter((q) => q.imageLink && cache[q.imageLink] === false).length;
  console.log(`[build_quests] banners: ${confirmed} ok, ${missing} missing (checked ${checked} new)`);
  return { cache, confirmed, missing };
}

async function main() {
  const srcFile = path.join(MAPS_DIR, 'quests.json');
  if (!fs.existsSync(srcFile)) {
    console.error(`[build_quests] missing input: ${srcFile}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
  const rawQuests = Array.isArray(raw) ? raw : raw.quests;
  if (!Array.isArray(rawQuests)) {
    console.error('[build_quests] unexpected source format: expected an array of quests');
    process.exit(1);
  }

  const quests = rawQuests.map((q) => {
    const id = q.normalizedName || slugify(q.name) || q.id;
    const quest = {
      id,
      gameId: q.id || null,
      name: q.name || null,
      normalizedName: q.normalizedName || id,
      trader: q.trader || null,
      map: q.map || null,
      minPlayerLevel: q.minPlayerLevel != null ? q.minPlayerLevel : null,
      kappa: !!q.kappa,
      lightkeeper: !!q.lightkeeper,
      experience: q.experience != null ? q.experience : null,
      wiki: q.wiki || null,
      antifandomLink: antifandomLink(q.wiki),
      imageLink: q.name ? `${ASSETS_ORIGIN}/${questAssetName(q.name)}.webp` : null,
      objectives: [],
    };
    if (Array.isArray(q.objectives)) {
      quest.objectives = q.objectives.map((o) => ({
        id: o.id || null,
        type: o.type || null,
        description: o.description || null,
        optional: !!o.optional,
        locations: (o.locations || []).map((l) => ({
          map: l.map || null,
          zoneId: l.zoneId || null,
          x: l.x != null ? l.x : null,
          y: l.y != null ? l.y : null,
          xPct: l.xPct != null ? l.xPct : null,
          yPct: l.yPct != null ? l.yPct : null,
          world: l.world ? { x: l.world.x, y: l.world.y, z: l.world.z } : null,
          level: l.level != null ? l.level : null,
          outline: Array.isArray(l.outline) ? l.outline : null,
        })),
      }));
    }
    return quest;
  });

  const { cache } = await verifyBanners(quests);
  for (const q of quests) {
    if (q.imageLink && cache[q.imageLink] === false) q.imageLink = null;
  }

  enrichQuestsWithRewards(quests);

  const out = {
    meta: {
      source: 'maps/quests.json (json.tarkov.dev regular/tasks + maps/traders/items catalogs)',
      generated: new Date().toISOString(),
      count: quests.length,
      idFormat: 'slug (normalized name); gameId holds the original game object id',
      notes: {
        imageLink: 'https://assets.tarkovlab.org/quests/<name>.webp (verified by HEAD request; null when missing)',
        antifandomLink: 'mirrored from the fandom wiki link',
      },
    },
    quests,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`[build_quests] ${quests.length} quests -> ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB)`);

  const withLoc = quests.filter((q) => q.objectives.some((o) => o.locations.length > 0));
  const byMap = {};
  for (const q of quests) {
    if (q.map) byMap[q.map] = (byMap[q.map] || 0) + 1;
  }
  console.log(`[build_quests] quests with map locations: ${withLoc.length}/${quests.length}`);
  console.log(`[build_quests] per map: ${Object.entries(byMap).map(([m, n]) => `${m}=${n}`).join(', ')}`);
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { enrichQuestsWithRewards };

if (require.main === module) {
  main().catch((err) => {
    console.error('[build_quests] failed:', err);
    process.exit(1);
  });
}
