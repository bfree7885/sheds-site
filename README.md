# sheds-site

Sheds – ethical GIS-based shed hunting decision support.

Part of the **Waypoint Studio** ecosystem of geospatial tools.

## Waypoint Studio Ecosystem

```
Waypoint Studio
  ├ Sheds           — terrain intelligence for shed hunting
  ├ Fieldry         — nature journaling and environmental observation
  ├ Signal Terrain  — geospatial situational awareness tools
  ├ Terrainbound    — terrain survival simulation
  ├ Savant Sommelier — geospatial wine terroir exploration
  └ Steepleaf       — ecological land suitability analysis
```

- **Waypoint Studio**: [waypointstudio/index.html](waypointstudio/index.html) — hub for all projects.
- **Sheds** (this site): [index.html](index.html), [fieldview.html](fieldview.html) — mapping, heatmaps, and field observations for shed hunting.
- **Fieldry**: [fieldry/](fieldry/) — nature journaling and environmental observation (coming soon).
- **Signal Terrain**: [signalterrain/](signalterrain/) — geospatial situational awareness (coming soon).
- **Terrainbound**: [terrainbound/](terrainbound/) — terrain survival simulation (coming soon).
- **Savant Sommelier**: [savantsommelier/](savantsommelier/) — geospatial wine terroir exploration (coming soon).
- **Steepleaf**: [steepleaf/](steepleaf/) — ecological land suitability analysis (coming soon).

## Sheds Structure

- `/index.html` — Homepage
- `/fieldview.html` — MapLibre Field View (map, GPS, observations, tracking)
- `/field-guide/` — Educational content on deer behavior and shed ecology
- `/briefs/` — Field Notes (research summaries)
- `/styles.css` — Global styles

## Run locally (with Observation API)

From the repo root:

```bash
cd api
npm install
npm start
```

Then open **http://localhost:3000/fieldview.html**. Observations load automatically when the map loads. Use **Add Observation** (click map) to save a point.

## GitHub Pages

The site is structured for static deployment. Serve the repo root as the document root. For full observation logging and heatmaps, run the API locally and set `window.SHEDS_API_BASE = 'http://localhost:3000'` before loading Field View.
