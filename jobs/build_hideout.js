#!/usr/bin/env node
/**
 * Job: build the hideout catalog for TarkovLab.
 *
 * Consumes (jobs/raw/):
 *   - pve_hideout.json — json.tarkov.dev/pve/hideout (28 stations, levels)
 *   - pve_crafts.json  — json.tarkov.dev/pve/crafts (crafts per station)
 *   - data/items.json  — the resolved item catalog
 *
 * Produces data/hideout.json — the catalog served by tarkovlab-api:
 *   - id: slug (normalized name), gameId: original station object id
 *   - imageLink: https://assets.tarkovlab.org/hideout/<slug>.png
 *   - levels: upgrade requirements resolved (items, stations, traders, skills)
 *   - crafts: hideout crafts for this station (product + requiredItems
 *     resolved with full item info, duration, level)
 *
 *   node jobs/build_hideout.js
 */
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const RAW = path.join(HERE, 'raw');
const OUT_FILE = path.join(ROOT, 'data', 'hideout.json');

const STATION_NAMES = {
  vents: 'Vents',
  security: 'Security',
  lavatory: 'Lavatory',
  generator: 'Generator',
  stash: 'Stash',
  'water-collector': 'Water Collector',
  medstation: 'Medstation',
  heating: 'Heating',
  'nutrition-unit': 'Nutrition Unit',
  'rest-space': 'Rest Space',
  workbench: 'Workbench',
  'intelligence-center': 'Intelligence Center',
  'shooting-range': 'Shooting Range',
  library: 'Library',
  'scav-case': 'Scav Case',
  illumination: 'Illumination',
  'hall-of-fame': 'Hall of Fame',
  'air-filtering-unit': 'Air Filtering Unit',
  'solar-power': 'Solar Power',
  'booze-generator': 'Booze Generator',
  'bitcoin-farm': 'Bitcoin Farm',
  'defective-wall': 'Defective Wall',
  gym: 'Gym',
  'weapon-rack': 'Weapon Rack',
  'gear-rack': 'Gear Rack',
  'cultist-circle': 'Cultist Circle',
  'bonus-pool': 'Bonus Pool',
  bitcoin: 'Bitcoin',
};

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function titleSlug(name) {
  return String(name || '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function main() {
  const rawStations = readJSON(path.join(RAW, 'pve_hideout.json')).data;
  const rawCrafts = readJSON(path.join(RAW, 'pve_crafts.json')).data;
  const itemsData = readJSON(path.join(ROOT, 'data', 'items.json')).items;
  const itemByGameId = new Map(itemsData.map((i) => [i.gameId, i]));
  const rawTraderNames = readJSON(path.join(RAW, 'pve_traders.json')).data;

  const traderNames = {};
  for (const [id, t] of Object.entries(rawTraderNames)) {
    traderNames[id] = t.normalizedName;
  }

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

  const stations = [];
  const stationByGameId = new Map();
  for (const [gameId, s] of Object.entries(rawStations)) {
    const slug = s.normalizedName || gameId;
    const station = {
      id: slug,
      gameId,
      name: STATION_NAMES[slug] || s.name || titleSlug(slug),
      imageLink: `https://assets.tarkovlab.org/hideout/${slug.replace(/-/g, '_')}.png`,
      levels: (s.levels || []).map((l) => ({
        level: l.level,
        constructionTime: l.constructionTime != null ? l.constructionTime : null,
        itemRequirements: (l.itemRequirements || []).map((r) => {
          const it = resolveItem(r.item);
          return {
            item: it || { id: r.item, name: r.item, shortName: null, imageLink: null, fallbackIconLink: null },
            count: r.count != null ? r.count : null,
            foundInRaid: !!(r.attributes || {}).foundInRaid,
          };
        }),
        stationLevelRequirements: (l.stationLevelRequirements || []).map((r) => ({
          station: r.station,
          level: r.level,
        })),
        traderRequirements: (l.traderRequirements || []).map((r) => ({
          trader: traderNames[r.trader] || r.trader,
          value: r.value != null ? r.value : null,
        })),
        skillRequirements: (l.skillRequirements || []).map((r) => ({
          name: r.name || null,
          level: r.level != null ? r.level : null,
        })),
      })),
      crafts: [],
    };
    stations.push(station);
    stationByGameId.set(gameId, station);
  }

  let craftCount = 0;
  for (const craft of rawCrafts) {
    const station = stationByGameId.get(craft.station);
    if (!station) continue;
    const product = resolveItem((craft.productItem || {}).item);
    if (!product) continue;
    const entry = {
      id: craft.id,
      duration: craft.duration != null ? craft.duration : null,
      level: craft.level != null ? craft.level : null,
      productItem: { ...product, count: craft.productItem.count },
      requiredItems: [],
    };
    for (const req of craft.requiredItems || []) {
      const it = resolveItem(req.item);
      if (!it) continue;
      entry.requiredItems.push({ ...it, count: req.count });
    }
    station.crafts.push(entry);
    craftCount++;
  }

  stations.sort((a, b) => a.name.localeCompare(b.name));

  const out = {
    meta: {
      source: 'jobs/raw/pve_hideout.json + pve_crafts.json (json.tarkov.dev/pve) + data/items.json',
      generated: new Date().toISOString(),
      count: stations.length,
      idFormat: 'slug (normalized name); gameId holds the original station object id',
      notes: {
        imageLink: 'https://assets.tarkovlab.org/hideout/<slug>.png',
        levels: 'item/station/trader/skill requirements resolved',
        crafts: 'crafts for this station with resolved items',
      },
    },
    stations,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  const stats = fs.statSync(OUT_FILE);
  console.log(`[build_hideout] ${stations.length} stations -> ${OUT_FILE} (${(stats.size / 1024).toFixed(0)} KB)`);
  console.log(`[build_hideout] ${craftCount} crafts attached`);
  const withC = stations.filter((s) => s.crafts.length > 0);
  console.log(`[build_hideout] stations with crafts: ${withC.map((s) => `${s.name}=${s.crafts.length}`).join(', ')}`);
}

main();
