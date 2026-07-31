#!/usr/bin/env node
/**
 * Job: build Lighthouse map dataset from the ATLAS extraction.
 *
 * Consumes:
 *   - the ATLAS Lighthouse extraction (colliders.json for quest zones,
 *     interact_189.json for interactables, lights_191.json for lights)
 *   - the maps/ web app dataset (maps/data/lighthouse.json: quest objectives
 *     + extracts with their SVG projection)
 *
 * Produces data/lighthouse.json — the full map payload served by
 * tarkovlab-api: objectives, extracts, zones (from the game's own trigger
 * colliders), interactables and lights, all projected onto the Lighthouse SVG.
 *
 *   node jobs/build_lighthouse.js
 *   ATLAS_DIR=../atlas/eft_assets/lighthouse MAPS_DIR=../maps node jobs/build_lighthouse.js
 */
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');

const ATLAS_DIR = path.resolve(process.env.ATLAS_DIR || path.join(ROOT, '..', 'atlas', 'eft_assets', 'lighthouse'));
const MAPS_DIR = path.resolve(process.env.MAPS_DIR || path.join(ROOT, '..', 'maps'));
const OUT_FILE = path.join(ROOT, 'data', 'lighthouse.json');

// ---------------------------------------------------------------------------
// World -> SVG projection, fitted from the maps dataset (objectives/extracts
// carry both a game world position and an xPct/yPct on the SVG).
// ---------------------------------------------------------------------------
function fitAffine(samples) {
  // samples: [{ x, z, xPct, yPct }]
  // Solve (least squares) for xPct = a*x + b*z + c and yPct = d*x + e*z + f.
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const Bx = [0, 0, 0];
  const By = [0, 0, 0];
  for (const s of samples) {
    const x = s.x, z = s.z;
    A[0][0] += x * x; A[0][1] += x * z; A[0][2] += x;
    A[1][0] += x * z; A[1][1] += z * z; A[1][2] += z;
    A[2][0] += x;     A[2][1] += z;     A[2][2] += 1;
    Bx[0] += x * s.xPct; Bx[1] += z * s.xPct; Bx[2] += s.xPct;
    By[0] += x * s.yPct; By[1] += z * s.yPct; By[2] += s.yPct;
  }
  function solve(M, B) {
    // Gaussian elimination with partial pivoting, in-place.
    for (let col = 0; col < 3; col++) {
      let piv = col;
      for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (piv !== col) { const t = M[col]; M[col] = M[piv]; M[piv] = t; const b = B[col]; B[col] = B[piv]; B[piv] = b; }
      const d = M[col][col];
      if (d === 0) throw new Error('singular projection fit');
      for (let j = col; j < 3; j++) M[col][j] /= d;
      B[col] /= d;
      for (let r = 0; r < 3; r++) {
        if (r === col) continue;
        const f = M[r][col];
        for (let j = col; j < 3; j++) M[r][j] -= f * M[col][j];
        B[r] -= f * B[col];
      }
    }
    return B;
  }
  const cx = solve(A.map((r) => r.slice()), Bx.slice());
  const cy = solve(A.map((r) => r.slice()), By.slice());
  return {
    project(x, z) {
      return { xPct: cx[0] * x + cx[1] * z + cx[2], yPct: cy[0] * x + cy[1] * z + cy[2] };
    },
    residual() {
      let e = 0;
      for (const s of samples) {
        const p = this.project(s.x, s.z);
        e += Math.abs(p.xPct - s.xPct) + Math.abs(p.yPct - s.yPct);
      }
      return e / samples.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Collider -> zone geometry
// ---------------------------------------------------------------------------
function colliderCorners(c) {
  // m is a Unity column-major 4x4 matrix; position = (m[3], m[7], m[11]).
  // s is the collider half-size. Emit the 8 world-space corners.
  const m = c.m;
  const pos = [m[3], m[7], m[11]];
  const R = [
    [m[0], m[4], m[8]],
    [m[1], m[5], m[9]],
    [m[2], m[6], m[10]],
  ];
  const s = c.s || [1, 1, 1];
  const out = [];
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        const l = [sx * s[0], sy * s[1], sz * s[2]];
        out.push([
          R[0][0] * l[0] + R[0][1] * l[1] + R[0][2] * l[2] + pos[0],
          R[1][0] * l[0] + R[1][1] * l[1] + R[1][2] * l[2] + pos[1],
          R[2][0] * l[0] + R[2][1] * l[1] + R[2][2] * l[2] + pos[2],
        ]);
      }
    }
  }
  return out;
}

function convexHull(pts) {
  // 2D convex hull (monotone chain), returns ordered outline points.
  const sorted = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const mapsFile = path.join(MAPS_DIR, 'data', 'lighthouse.json');
  const questsFile = path.join(MAPS_DIR, 'quests.json');
  const collidersFile = path.join(ATLAS_DIR, 'colliders.json');
  const interactFile = path.join(ATLAS_DIR, 'interact_189.json');
  const lightsFile = path.join(ATLAS_DIR, 'lights_191.json');

  for (const f of [mapsFile, collidersFile, interactFile, lightsFile]) {
    if (!fs.existsSync(f)) {
      console.error(`[build_lighthouse] missing input: ${f}`);
      process.exit(1);
    }
  }
  if (!fs.existsSync(questsFile)) {
    console.error(`[build_lighthouse] missing input: ${questsFile} (needed to link objectives to quest pages)`);
    process.exit(1);
  }

  const maps = readJson(mapsFile);
  const colliders = readJson(collidersFile);
  const interact = readJson(interactFile);
  const lights = readJson(lightsFile);
  const questsRaw = readJson(questsFile);
  const quests = Array.isArray(questsRaw) ? questsRaw : questsRaw.quests;

  // gameId (the original object id) -> quest slug, to link objectives to /quests/:id pages
  // Accepts both the transformed catalog (id=slug, gameId=object id) and the raw
  // maps/quests.json source format (id=object id, normalizedName=slug).
  const questSlugByGameId = new Map();
  for (const q of quests) {
    if (q.gameId && q.id) questSlugByGameId.set(q.gameId, q.id);
    else if (q.id && q.normalizedName) questSlugByGameId.set(q.id, q.normalizedName);
  }
  let linked = 0;
  for (const o of maps.objectives) {
    if (o.questId && questSlugByGameId.has(o.questId)) {
      o.questSlug = questSlugByGameId.get(o.questId);
      linked++;
    }
  }
  console.log(`[build_lighthouse] objectives linked to quest pages: ${linked}/${maps.objectives.length}`);

  // Fit the world -> SVG projection from the maps dataset.
  const samples = [];
  for (const o of maps.objectives.concat(maps.extracts)) {
    if (o.world && typeof o.world.x === 'number' && typeof o.world.z === 'number') {
      samples.push({ x: o.world.x, z: o.world.z, xPct: o.xPct, yPct: o.yPct });
    }
  }
  if (samples.length < 3) {
    console.error('[build_lighthouse] not enough world samples to fit projection');
    process.exit(1);
  }
  const proj = fitAffine(samples);
  console.log(`[build_lighthouse] projection fitted from ${samples.length} samples, mean residual ${proj.residual().toExponential(2)}`);

  // Quest zones: trigger colliders under the QUESTS root.
  const zones = [];
  for (const c of colliders.colliders) {
    const go = c.go || '';
    if (c.root !== 'QUESTS' || !go) continue;
    const corners = colliderCorners(c);
    const projected = corners.map((w) => {
      const p = proj.project(w[0], w[2]);
      return [p.xPct * maps.viewBox[2], p.yPct * maps.viewBox[3]];
    });
    const outline = convexHull(projected);
    const center = proj.project(c.m[3], c.m[11]);
    zones.push({
      zoneId: go,
      level: null,
      xPct: center.xPct,
      yPct: center.yPct,
      x: center.xPct * maps.viewBox[2],
      y: center.yPct * maps.viewBox[3],
      world: { x: c.m[3], y: c.m[7], z: c.m[11] },
      outline,
    });
  }
  zones.sort((a, b) => a.zoneId.localeCompare(b.zoneId));
  console.log(`[build_lighthouse] zones: ${zones.length}`);

  // Interactables (radios, switches...).
  const interactables = interact.map((o) => {
    const p = proj.project(o.world_pos[0], o.world_pos[2]);
    return {
      id: o.id,
      label: o.label,
      kind: o.kind,
      trigger: o.trigger || null,
      level: o.level || null,
      xPct: p.xPct,
      yPct: p.yPct,
      x: p.xPct * maps.viewBox[2],
      y: p.yPct * maps.viewBox[3],
      world: { x: o.world_pos[0], y: o.world_pos[1], z: o.world_pos[2] },
    };
  });
  console.log(`[build_lighthouse] interactables: ${interactables.length}`);

  // Lights (position only; colour/intensity kept for reference).
  const lightArr = lights.map((l) => {
    const p = proj.project(l.position[0], l.position[2]);
    return {
      name: l.name || null,
      type: l.type || null,
      on: l.on,
      xPct: p.xPct,
      yPct: p.yPct,
      x: p.xPct * maps.viewBox[2],
      y: p.yPct * maps.viewBox[3],
      world: { x: l.position[0], y: l.position[1], z: l.position[2] },
      color: l.color || null,
      intensity: l.intensity != null ? l.intensity : null,
      range: l.range != null ? l.range : null,
    };
  });
  console.log(`[build_lighthouse] lights: ${lightArr.length}`);

  const out = {
    map: maps.map,
    name: maps.name,
    svg: maps.svg,
    viewBox: maps.viewBox,
    levels: maps.levels,
    objectiveCount: maps.objectives.length,
    objectives: maps.objectives,
    extracts: maps.extracts,
    zones,
    interactables,
    lights: lightArr,
    projection: {
      fit: samples.length,
      note: 'fitted from the maps dataset world/svg samples; identical to the tarkov.dev projection',
    },
    sources: {
      objectives: 'maps/data/lighthouse.json (tarkov.dev static catalog)',
      zones: 'atlas/eft_assets/lighthouse/colliders.json (QUESTS trigger colliders)',
      interactables: 'atlas/eft_assets/lighthouse/interact_189.json',
      lights: 'atlas/eft_assets/lighthouse/lights_191.json',
    },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`[build_lighthouse] wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB)`);
}

main();
