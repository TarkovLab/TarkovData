<div align="center">

<h1>
  <img src="https://logo.tarkovlab.org/tl-data" alt="TarkovLab" style="vertical-align:middle;" />
</h1>

<p>Community-maintained game data for <strong>Escape From Tarkov</strong>, powering tools built on the <a href="https://tarkovlab.org">TarkovLab</a> ecosystem.</p>

<!-- Stars -->
<a href="https://github.com/TarkovLab/TarkovData/stargazers">
  <img src="https://img.shields.io/github/stars/TarkovLab/TarkovData?style=for-the-badge&logo=github&logoColor=white&color=FFD700&labelColor=1a1a2e" alt="Stars" />
</a>
<!-- Last Commit -->
<a href="https://github.com/TarkovLab/TarkovData/commits/master">
  <img src="https://img.shields.io/github/last-commit/TarkovLab/TarkovData?style=for-the-badge&logo=git&logoColor=white&color=4CAF50&labelColor=1a1a2e" alt="Last Commit" />
</a>
<!-- Contributors -->
<a href="https://github.com/TarkovLab/TarkovData/graphs/contributors">
  <img src="https://img.shields.io/github/contributors/TarkovLab/TarkovData?style=for-the-badge&logo=github&logoColor=white&color=6C63FF&labelColor=1a1a2e" alt="Contributors" />
</a>
<!-- Pull Requests (all) -->
<a href="https://github.com/TarkovLab/TarkovData/pulls?q=is%3Apr">
  <img src="https://img.shields.io/github/issues-pr/TarkovLab/TarkovData?style=for-the-badge&logo=git-pull-request&logoColor=white&color=00BCD4&labelColor=1a1a2e&label=pull%20requests" alt="Pull Requests" />
</a>
<!-- Issues (all) -->
<a href="https://github.com/TarkovLab/TarkovData/issues?q=is%3Aissue">
  <img src="https://img.shields.io/github/issues/TarkovLab/TarkovData?style=for-the-badge&logo=github&logoColor=white&color=FF5722&labelColor=1a1a2e" alt="Issues" />
</a>

</div>

---

## What is TarkovData?

**TarkovData** is a structured, community-driven dataset containing game information for [Escape From Tarkov](https://www.escapefromtarkov.com/), designed to make building tools and trackers as easy as possible.

This repository is a **fork of [TarkovTracker/tarkovdata](https://github.com/TarkovTracker/tarkovdata)**, originally created by [Thaddeus](https://github.com/thaddeus), and adapted for use within the [TarkovLab](https://tarkovlab.org) ecosystem.


## Data jobs

`data/` files that come from the game's own files are produced by **jobs** in [`jobs/`](jobs/), which
ingest the ATLAS extraction pipeline output and project it onto the map SVGs.

| Job | Produces | Inputs |
| --- | -------- | ------ |
| [`jobs/build_lighthouse.js`](jobs/build_lighthouse.js) | `data/lighthouse.json` | ATLAS `eft_assets/lighthouse/` (colliders, interactables, lights) + `maps/data/lighthouse.json` (objectives/extracts) |
| [`jobs/build_quests.js`](jobs/build_quests.js) | `data/quests.json` | `maps/quests.json` (raw quest catalog) |

Run a job with `npm run build:<name>` (e.g. `npm run build:lighthouse`, `npm run build:quests`). Input
paths are resolved relative to the repository layout (`../atlas/eft_assets/<map>`, `../maps`); override
with `ATLAS_DIR` / `MAPS_DIR` environment variables.

### `data/quests.json`

Full quest catalog (501 quests) served to tarkovlab-api. Each quest carries:

- `id` — public slug (`normalizedName`, e.g. `shooting-cans`), used in `/quests/:id` URLs
- `gameId` — the original game object id (hex string)
- `name`, `normalizedName`, `trader`, `map`, `minPlayerLevel`, `kappa`, `lightkeeper`, `faction`,
  `experience`, `wiki`
- `objectives[]` — `id`, `type` (`mark`, `visit`, `plantItem`, `shoot`, ...), `description`,
  `optional`, and `locations[]` with per-map SVG projection (`xPct`/`yPct`, pixel `x`/`y`),
  `world` coordinates, `level` and `outline` polygons

`build_lighthouse.js` links every objective to its quest page by adding `questSlug` (matched via the
game object id), so map markers can deep-link to `/quests/:id`.


## Contributing

Contributions are welcome! To get started:

1. **Fork** this repository
2. **Create a branch** for your changes
3. **Open a Pull Request** against `master`

> If your contribution involves a **schema change**, please open an issue first to discuss it with maintainers — we don't want your work to go to waste if the change doesn't align with the project direction.

Every PR is automatically validated by the [JSON Syntax Check](.github/workflows/node.js.yml) workflow, which scans **all** `.json` files in the repository dynamically. A PR cannot be merged if any JSON file is invalid.

---

## License & Credits

- Originally created by **[Thaddeus](https://github.com/thaddeus)** as part of [TarkovTracker](https://github.com/TarkovTracker/tarkovdata)
- Maintained and extended by the **[TarkovLab](https://tarkovlab.org)** community
- Map SVGs in [`maps/`](maps/) are sourced from **[the-hideout/tarkov-dev-svg-maps](https://github.com/the-hideout/tarkov-dev-svg-maps)** and licensed under [CC BY-NC-SA 4.0](maps/LICENSE.md)

<div align="center">
  <sub>Game content and materials are trademarks and copyrights of Battlestate Games and its licensors. All rights reserved.</sub>
</div>
