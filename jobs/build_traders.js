#!/usr/bin/env node
/**
 * Job: build the trader catalog for TarkovLab.
 *
 * Consumes (jobs/raw/):
 *   - pve_traders.json — json.tarkov.dev/pve/traders (16 traders, names are
 *                        placeholders; resolved by the hard-coded table below)
 *   - pve_barters.json — json.tarkov.dev/pve/barters (barter offers per trader)
 *   - data/items.json  — the resolved item catalog (names/slugs for barters)
 *
 * Produces data/traders.json — the catalog served by tarkovlab-api:
 *   - id: slug (e.g. "btr-driver"), gameId: original trader object id
 *   - imageLink: https://assets.tarkovlab.org/traders/<slug>.webp
 *   - barters: resolved barter offers (offeredItem + requiredItems with the
 *     full item info embedded, minTraderLevel, taskUnlock)
 *
 *   node jobs/build_traders.js
 */
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const RAW = path.join(HERE, 'raw');
const OUT_FILE = path.join(ROOT, 'data', 'traders.json');

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

function main() {
  const rawTraders = readJSON(path.join(RAW, 'pve_traders.json')).data;
  const rawBarters = readJSON(path.join(RAW, 'pve_barters.json')).data;
  const itemsData = readJSON(path.join(ROOT, 'data', 'items.json')).items;
  const itemByGameId = new Map(itemsData.map((i) => [i.gameId, i]));

  const resolveItem = (itemId) => {
    const it = itemByGameId.get(itemId);
    if (!it) return null;
    return {
      id: it.id,
      name: it.name,
      shortName: it.shortName,
      imageLink: it.imageLink,
      fallbackIconLink: it.fallbackIconLink,
    };
  };

  const slugFor = (id) =>
    String(TRADER_NAMES[id] || id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const traders = [];
  for (const [gameId, t] of Object.entries(rawTraders)) {
    const slug = t.normalizedName || slugFor(gameId);
    traders.push({
      id: slug,
      gameId,
      name: TRADER_NAMES[gameId] || t.name || gameId,
      imageLink: `https://assets.tarkovlab.org/traders/${slug.replace(/-/g, '_')}.webp`,
      currency: t.currency || null,
      resetTime: t.resetTime || null,
      levels: (t.levels || []).map((l) => ({
        level: l.level,
        requiredPlayerLevel: l.requiredPlayerLevel,
        requiredReputation: l.requiredReputation,
        payRate: l.payRate != null ? l.payRate : null,
        insuranceRate: l.insuranceRate != null ? l.insuranceRate : null,
      })),
      barters: [],
    });
  }

  const traderById = new Map(traders.map((t) => [t.gameId, t]));
  let resolved = 0;
  let skipped = 0;
  for (const barter of rawBarters) {
    const trader = traderById.get(barter.trader);
    if (!trader) {
      skipped++;
      continue;
    }
    const offered = resolveItem(barter.offeredItem.item);
    if (!offered) {
      skipped++;
      continue;
    }
    const entry = {
      id: barter.id,
      taskUnlock: barter.taskUnlock || null,
      minTraderLevel: barter.minTraderLevel != null ? barter.minTraderLevel : null,
      restockAmount: barter.restockAmount != null ? barter.restockAmount : null,
      buyLimit: barter.buyLimit != null ? barter.buyLimit : null,
      offeredItem: { ...offered, count: barter.offeredItem.count },
      requiredItems: [],
    };
    for (const req of barter.requiredItems || []) {
      const it = resolveItem(req.item);
      if (!it) continue;
      entry.requiredItems.push({ ...it, count: req.count });
    }
    trader.barters.push(entry);
    resolved++;
  }

  traders.sort((a, b) => a.name.localeCompare(b.name));

  const out = {
    meta: {
      source: 'jobs/raw/pve_traders.json + pve_barters.json (json.tarkov.dev/pve) + data/items.json',
      generated: new Date().toISOString(),
      count: traders.length,
      idFormat: 'slug (normalized name); gameId holds the original trader object id',
      notes: {
        imageLink: 'https://assets.tarkovlab.org/traders/<slug>.webp',
        barters: 'barter offers resolved with full item info',
      },
    },
    traders,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  const stats = fs.statSync(OUT_FILE);
  console.log(`[build_traders] ${traders.length} traders -> ${OUT_FILE} (${(stats.size / 1024).toFixed(0)} KB)`);
  console.log(`[build_traders] ${resolved} barters resolved, ${skipped} skipped`);
  const withB = traders.filter((t) => t.barters.length > 0);
  console.log(`[build_traders] traders with barters: ${withB.map((t) => `${t.name}=${t.barters.length}`).join(', ')}`);
}

main();
