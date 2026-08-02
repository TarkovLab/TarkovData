#!/usr/bin/env node
/**
 * Job: build the full item catalog for TarkovLab.
 *
 * Consumes (jobs/raw/):
 *   - pve_items.json     — json.tarkov.dev/pve/items (raw, names unresolved)
 *   - items_en.json      — TarkovTracker/tarkovdata items.en.json (EN names by
 *                          BSG uid)
 *   - pve_barters.json   — json.tarkov.dev/pve/barters
 *   - pve_crafts.json    — json.tarkov.dev/pve/crafts
 *   - pve_tasks.json     — json.tarkov.dev/pve/tasks (objective -> items)
 *   - ../maps/quests.json — resolved quest catalog (objective ids/descriptions)
 *
 * Produces data/items.json — the catalog served by tarkovlab-api:
 *   - id: slug (normalized name), gameId: original game object id
 *   - name/shortName resolved from items_en.json
 *   - imageLink: https://assets.tarkovlab.org/items/<shortName slug>-icon.webp
 *     (fallback to the tarkov.dev asset, which is keyed by game id)
 *   - neededFor.quests:  which quests require the item, how many, and why
 *     (objective type + description)
 *   - neededFor.barters: which barters require the item
 *   - neededFor.crafts:  which hideout crafts require the item
 *
 *   node jobs/build_items.js
 */
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const RAW = path.join(HERE, 'raw');
const MAPS_DIR = path.resolve(process.env.MAPS_DIR || path.join(ROOT, '..', 'maps'));
const OUT_FILE = path.join(ROOT, 'data', 'items.json');

const TRADER_NAMES = {
  '54cb50c76803fa8b248b4571': 'Prapor',
  '54cb57776803fa99248b456e': 'Therapist',
  '579dc571d53a0658a154fbec': 'Fence',
  '58330581ace78e27b8b10cee': 'Skier',
  '5935c25fb3acc3127c3d8cd9': 'Peacekeeper',
  '5a7c2eca46aef81a7ca2145d': 'Mechanic',
  '5ac3b934156ae10c4430e83c': 'Ragman',
  '5c0647fdd443bc2504c2d371': 'Jaeger',
  '638f541a29ffd1183d187f57': 'Lightkeeper',
  '68fe15910f29ba3fdbba9d54': 'Taran',
  '656f0f98d80a697f855d34b1': 'BTR Driver',
  '68fe15990f29ba3fdbba9d55': 'Radio Station',
  '6617beeaa9cfa777ca915b7c': 'Ref',
  '688246518448b05efd61d461': 'Mr Kerman',
  '688246958448b05efd61d462': 'Voevoda',
  '69e0d6cc77b63940375b9173': 'Survivor',
};

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assetSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function traderSlug(id) {
  return (TRADER_NAMES[id] || id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function antifandomLink(wiki) {
  if (!wiki) return null;
  return wiki.replace('escapefromtarkov.fandom.com/wiki/', 'antifandom.com/escapefromtarkov/wiki/');
}

function main() {
  const rawItems = readJSON(path.join(RAW, 'pve_items.json')).data.items;
  const namesEn = readJSON(path.join(RAW, 'items_en.json'));
  const rawBarters = readJSON(path.join(RAW, 'pve_barters.json')).data;
  const rawCrafts = readJSON(path.join(RAW, 'pve_crafts.json')).data;
  const rawTasks = readJSON(path.join(RAW, 'pve_tasks.json')).data.tasks;
  const questsRaw = readJSON(path.join(MAPS_DIR, 'quests.json'));
  const quests = (Array.isArray(questsRaw) ? questsRaw : questsRaw.quests) || [];

  const byGameId = new Map();
  for (const q of quests) byGameId.set(q.id, q);

  const itemMap = new Map(); // gameId -> item
  const items = [];
  for (const [gameId, it] of Object.entries(rawItems)) {
    const en = namesEn[gameId] || {};
    const name = en.name || null;
    const shortName = en.shortName || null;
    const itemId = it.normalizedName || assetSlug(shortName) || gameId;
    const assetBase = `https://assets.tarkovlab.org/items/${String(itemId).replace(/-/g, '_')}`;
    const item = {
      id: itemId,
      gameId,
      name,
      shortName,
      types: Array.isArray(it.types) ? it.types : [],
      backgroundColor: it.backgroundColor || 'default',
      weight: it.weight != null ? it.weight : null,
      width: it.width != null ? it.width : null,
      height: it.height != null ? it.height : null,
      basePrice: it.basePrice != null ? it.basePrice : null,
      wikiLink: it.wikiLink || null,
      antifandomLink: antifandomLink(it.wikiLink),
      imageLink: `${assetBase}-icon.webp`,
      fallbackIconLink: it.iconLink ? `${assetBase}-icon.webp` : null,
      gridImageLink: it.gridImageLink ? `${assetBase}-grid-image.webp` : null,
      image512pxLink: it.image512pxLink ? `${assetBase}-512.webp` : null,
      sellToTrader: (it.sellToTrader || []).map((o) => ({
        trader: traderSlug(o.trader),
        price: o.priceRUB != null ? o.priceRUB : o.price,
      })),
      buyFromTrader: (it.buyFromTrader || []).map((o) => ({
        trader: traderSlug(o.trader),
        price: o.priceRUB != null ? o.priceRUB : o.price,
        minTraderLevel: o.minTraderLevel != null ? o.minTraderLevel : null,
        taskUnlock: o.taskUnlock || null,
      })),
      neededFor: { quests: [], barters: [], crafts: [] },
    };
    items.push(item);
    itemMap.set(gameId, item);
  }

  const resolve = (gameId) => itemMap.get(gameId) || null;

  // --- quests (pve_tasks objectives -> quests.json) ---
  let qCount = 0;
  let qEntryCount = 0;
  for (const task of Object.values(rawTasks)) {
    const quest = byGameId.get(task.id);
    if (!quest) continue;
    qCount++;
    const questSlug = quest.normalizedName || quest.id;
    for (const obj of task.objectives || []) {
      if (!Array.isArray(obj.items) || obj.items.length === 0) continue;
      const count = obj.count != null ? obj.count : 1;
      const qObj = (quest.objectives || []).find((o) => o.id === obj.id) || {};
      for (const itemId of obj.items) {
        const item = resolve(itemId);
        if (!item) continue;
        item.neededFor.quests.push({
          quest: questSlug,
          questName: quest.name || questSlug,
          objectiveId: obj.id,
          objectiveType: obj.type,
          objectiveDescription: qObj.description || obj.description || null,
          count,
        });
        qEntryCount++;
      }
    }
  }

  // --- barters ---
  let bCount = 0;
  for (const barter of rawBarters) {
    for (const req of barter.requiredItems || []) {
      const item = resolve(req.item);
      if (!item) continue;
      item.neededFor.barters.push({
        barter: barter.id,
        trader: traderSlug(barter.trader),
        traderName: TRADER_NAMES[barter.trader] || barter.trader,
        minTraderLevel: barter.minTraderLevel != null ? barter.minTraderLevel : null,
        count: req.count,
      });
      bCount++;
    }
  }

  // --- crafts ---
  let cCount = 0;
  for (const craft of rawCrafts) {
    for (const req of craft.requiredItems || []) {
      const item = resolve(req.item);
      if (!item) continue;
      item.neededFor.crafts.push({
        craft: craft.id,
        station: craft.station,
        level: craft.level != null ? craft.level : null,
        duration: craft.duration != null ? craft.duration : null,
        count: req.count,
      });
      cCount++;
    }
  }

  items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const out = {
    meta: {
      source: 'jobs/raw/pve_items.json (json.tarkov.dev/pve/items) + items_en.json (TarkovTracker) + pve_barters.json + pve_crafts.json + pve_tasks.json',
      generated: new Date().toISOString(),
      count: items.length,
      idFormat: 'slug (normalized name); gameId holds the original game object id',
      notes: {
        imageLink: 'https://assets.tarkovlab.org/items/<shortName slug>-icon.webp; fallbackIconLink is the tarkov.dev asset keyed by gameId',
        backgroundColor: 'EFT inventory slot color name (black/blue/green/grey/orange/red/violet/yellow/default) used for tile backgrounds',
        neededFor: 'quests/barters/crafts entries referencing this item, with the required count',
      },
    },
    items,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  const stats = fs.statSync(OUT_FILE);
  console.log(`[build_items] ${items.length} items -> ${OUT_FILE} (${(stats.size / 1024).toFixed(0)} KB)`);
  console.log(`[build_items] neededFor: ${qCount} quests matched (${qEntryCount} item entries), ${bCount} barter entries, ${cCount} craft entries`);
  const withQ = items.filter((i) => i.neededFor.quests.length > 0).length;
  const withB = items.filter((i) => i.neededFor.barters.length > 0).length;
  const withC = items.filter((i) => i.neededFor.crafts.length > 0).length;
  console.log(`[build_items] items referenced by: quests=${withQ}, barters=${withB}, crafts=${withC}`);
}

main();
