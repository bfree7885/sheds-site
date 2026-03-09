# Sheds Platform — Development Plan

This plan turns the current static site and Field View prototype into the full GIS-driven shed hunting platform described in PRODUCT.md. It is phased so you can ship value early and extend incrementally.

---

## 1. Project Summary

**Current state**
- **Home**: Static page with preview layers and nav (Field Guide, Field Notes, Field View).
- **Field Guide**: Evergreen educational content (whitetail biology, habitat, shed basics).
- **Field Notes**: Research briefs (AI-summarized wildlife/gov/university sources).
- **Field View**: Mapbox map with GPS, track recording, hillshade, “Add Observation” (terrain only; markers in-memory; no structured schema or persistence).
- **Data model**: Documented in `data-model.md` (location, date, antler data, terrain, habitat, environment).
- **Hosting**: GitHub Pages; no backend or database.

**Target state (from PRODUCT.md)**
- Same four sections, with Field View as the core product: interactive map with GPS, offline maps, terrain layers, heatmap overlays, and structured observation logging.
- Observations feed an AI/terrain model that improves shed probability heatmaps.
- Research-grade dataset and published insights (Field Notes, eventual research articles and book).

---

## 2. Principles

- **Ship in phases**: Each phase delivers a usable slice (e.g. “log observations”, “see a heatmap”, “use offline”).
- **Data-first**: Observation schema and storage decisions support the long-term research and heatmap goals.
- **Progressive enhancement**: Core flows work without JS where possible; advanced features (map, tracking) require JS.
- **Ethics by design**: Education and access/seasonal context (see PAYWALL.md) are built in from the start, not bolted on later.

---

## 3. Phases Overview

| Phase | Focus | Outcome |
|-------|--------|--------|
| **0** | Foundation | Backend + schema + deployment pipeline |
| **1** | Observations | Structured observation form + persistence |
| **2** | Heatmaps | First heatmap layer (model v0) |
| **3** | Field View UX | Offline maps, layer controls, navigation polish |
| **4** | Intelligence | Personalization (species/region/date), Field Notes automation |
| **5** | Research & scale | Datasets, research outputs, optional book |

---

## 4. Phase 0 — Foundation

**Goal**: Backend, observation schema, and a clean path from local dev to production.

### 4.1 Backend and data store

- Choose a backend stack that can:
  - Ingest and store observations (and later, derived heatmap data).
  - Serve a small API for Field View (submit observation, fetch user’s observations, optional heatmap tiles or vector data).
- Options (pick one and stick with it):
  - **Serverless**: e.g. Netlify/Cloudflare Functions + Supabase/PlanetScale/Fauna for observations and auth.
  - **Traditional**: e.g. small Node/Python API + Postgres (e.g. Railway, Fly.io).
- Implement:
  - **Auth**: Anonymous or lightweight auth (e.g. magic link or OAuth) so observations can be tied to a “user” or device without forcing signup for first use.
  - **Observations table** (or equivalent) that matches `data-model.md`:
    - Location (lat, lng), date found.
    - Antler: points, estimated age class, condition.
    - Terrain: slope, aspect, elevation (can be computed server-side from DEM if needed).
    - Habitat: distance to food/water, vegetation type (optional at first).
    - Environment: snow depth, temperature, weather (optional at first).
  - Endpoints: `POST /observations`, `GET /observations` (scoped to user or public aggregate for heatmaps).

### 4.2 Deployment and environment

- Keep GitHub Pages for static assets (Home, Field Guide, Field Notes, Field View HTML/JS/CSS).
- Backend and DB on a separate host (see above).
- Use environment variables for API base URL and Mapbox token; no secrets in repo.
- Add a minimal CI step (e.g. in `.github/workflows`) to run lint/tests and deploy static site; backend deploys via its own pipeline.

### 4.3 Documentation

- Update `README.md` with: how to run the site locally, how to point Field View at local vs production API, and where the backend repo/link lives.
- Keep `PROJECT_STATE.md` (or a single “current goal” section) updated with “current phase” and “next step” so the plan stays actionable.

**Phase 0 exit criteria**: Backend deployed; observation schema in DB; Field View can call API (even if UI still uses localStorage for a short time); README and PROJECT_STATE reflect setup.

---

## 5. Phase 1 — Structured Observations

**Goal**: Users can add observations through a structured form; data is persisted and aligned with the research schema.

### 5.1 Observation form (Field View)

- Replace the current “click map → show terrain popup” flow with:
  - Click map (or “Add observation” then click) → open a **form** (sidebar or modal).
- Form fields (aligned with `data-model.md`):
  - **Auto-filled from map**: lat, lng, elevation, slope, aspect (from existing `calculateTerrain()` or API).
  - **User input**: date found, antler points, estimated age class, condition; optional: habitat type, weather, snow depth, temperature.
- Validation: required fields (at least location, date, basic antler info); clear errors.
- On submit: send payload to backend `POST /observations`; on success, add a marker and optionally show a short confirmation.

### 5.2 Persistence and list view

- After submit, persist in backend (no reliance on localStorage for observations).
- Optional: “My observations” list or panel in Field View (from `GET /observations`) with edit/delete and map centering.
- Keep “saved hikes” (tracks) in localStorage for now unless you want them in the backend in Phase 1.

### 5.3 Ethics and education

- Short copy or link near the form: “Why we collect this” and link to Field Guide or a dedicated “Data & ethics” page.
- No personalization or paywall in Phase 1 (see PAYWALL.md for when to introduce it).

**Phase 1 exit criteria**: User can add an observation with full schema via form; data is stored in backend; user can see their observations on the map or in a list.

---

## 6. Phase 2 — Heatmaps

**Goal**: A first shed-probability heatmap layer in Field View, driven by terrain (and optionally early observation data).

### 6.1 Model v0

- Define a **terrain-only** model v0: e.g. slope, aspect, elevation, distance to water (if you have a water layer), land cover (if available). Use rules or a simple ML model (e.g. logistic regression or small gradient-boosted tree) trained on:
  - Public or synthetic “shed likely” points, or
  - Your own observations once you have enough.
- Output: probability or score per cell (e.g. 250 m grid) for a given region. Precompute for areas you care about (e.g. state or focus counties).

### 6.2 Heatmap in Field View

- Serve model output as:
  - Raster tiles (e.g. PNG/XYZ), or
  - Vector tiles / GeoJSON grid with a `score` property.
- Add a **heatmap layer** in Mapbox (or equivalent) in Field View; toggle in the same panel as “Terrain Shading”.
- Legend: e.g. “Shed probability (model v0)” with a simple color scale (low → high).
- Attribution and disclaimer: “Educational model; not a guarantee of finds.”

### 6.3 Iteration loop

- As observations grow, retrain or recalibrate the model periodically (e.g. monthly or quarterly); replace tiles and document “Model v1” with a short changelog in Field Notes or README.

**Phase 2 exit criteria**: One heatmap layer visible in Field View; model v0 documented; pipeline for recomputing tiles when data or model changes.

---

## 7. Phase 3 — Field View UX and Offline

**Goal**: Reliable navigation and layer control; offline map use for areas users care about.

### 7.1 Layer controls

- Panel or layer list: Terrain (hillshade), Heatmap, Observations (own + optionally public), Tracks. Toggles and opacity where useful.
- Optional: base map style switch (e.g. outdoors vs satellite) for different conditions.

### 7.2 Offline maps

- Use Mapbox offline APIs (or equivalent) so users can download a region (e.g. state or bounding box) for use without connectivity.
- In UI: “Download map for offline” with region picker or “current view”; show storage estimate and list of downloaded regions with option to remove.
- Ensure GPS, track recording, and observation form work offline: queue observation submits and sync when back online.

### 7.3 Navigation quality

- Improve “Find my terrain”: better handling of accuracy, optional compass/heading, and “recenter” while tracking.
- Saved hikes: optional export (GPX/GeoJSON) and clearer “Load saved hikes” behavior (e.g. list by name, show on map, don’t duplicate layers).

**Phase 3 exit criteria**: Layer toggles and heatmap/observations/tracks all usable; at least one region downloadable for offline use; observations sync after offline capture.

---

## 8. Phase 4 — Intelligence and Personalization

**Goal**: Context tailored to species, region, and date; Field Notes tied to the same context.

### 8.1 Personalization (paywall boundary)

- Per PAYWALL.md: free = general education and high-level previews; paid = personalized by species, region, and date.
- Implement:
  - **Species**: e.g. whitetail vs mule deer (affects heatmap and copy).
  - **Region**: state/county or geometry (drives which heatmap tiles and which Field Notes apply).
  - **Date**: seasonal sensitivity (e.g. closed season vs open; “late winter” vs “early spring”).
- Store preference in backend (after login) or in localStorage for anonymous; paywall triggers when user sets species/region/date and expects personalized heatmap or seasonal layer.

### 8.2 Land status and seasonal layer

- **Land status**: Public/private or similar (e.g. from existing or third-party data). Show as a layer; respect ethics messaging (e.g. “Check access; we don’t guarantee permission”).
- **Seasonal sensitivity**: Layer or banner that reflects open/closed or sensitive periods for the user’s region and date. Combined view (land status + seasonal) is the core paid capability in PAYWALL.md.

### 8.3 Field Notes automation

- Field Notes content: continue AI-summarized research; tag or filter by region, species, and time of year where relevant.
- Optional: simple CMS or pipeline (e.g. markdown → HTML, or Notion/Contentful) so new briefs can be added without editing repo by hand; preserve existing `/briefs/` structure and styling.

**Phase 4 exit criteria**: User can set species/region/date; heatmap and seasonal messaging use them; land status layer exists; paywall clearly separates free vs paid; Field Notes process is documented or automated.

---

## 9. Phase 5 — Research and Scale

**Goal**: Research-grade dataset, published outputs, and optional book.

### 9.1 Dataset and exports

- **Export**: For researchers (and you): anonymized or aggregated observation dataset (CSV/GeoJSON or similar) with clear license and citation.
- **Documentation**: Schema, quality flags, and how to request access (e.g. form or email); consider a simple “Data” page.

### 9.2 Research outputs

- Use Field Notes for short research summaries (e.g. “Shed distribution and terrain in Region X”).
- Optional: DOI or preprint for larger analyses; link from Field Notes and README.

### 9.3 Book and long-term

- If the dataset and insights grow, the same schema and exports support a book; no extra technical phase required beyond good documentation and consistent data quality.

**Phase 5 exit criteria**: Export available for researchers; at least one research summary or article published; “Data” and “Research” story clear on the site.

---

## 10. Technical Stack Suggestions

| Layer | Suggestion | Alternative |
|-------|------------|-------------|
| Frontend | Current static HTML/CSS/JS + Mapbox GL JS | React/Vue if you want a SPA later |
| Backend | Serverless (Netlify/Cloudflare) + Supabase or Fauna | Node + Postgres (Railway/Fly) |
| DB | Postgres (Supabase, Railway, Neon) | PlanetScale (MySQL) if you prefer |
| Auth | Supabase Auth or similar (magic link/OAuth) | Custom JWT + your backend |
| Maps | Mapbox (current) | MapLibre + your own tiles for cost control later |
| Heatmap tiles | Precomputed (e.g. Python + PostGIS or raster pipeline) | Server-side tile generation on demand (heavier) |
| Offline | Mapbox offline API or MapLibre offline | Same |
| CI | GitHub Actions (existing publish.yml) | Add backend deploy and tests |

---

## 11. Risk and Mitigation

| Risk | Mitigation |
|------|------------|
| Backend cost at scale | Start serverless + capped DB; add caching and read replicas only when needed. |
| Heatmap model too weak | Ship v0 as “educational”; set expectation in UI; improve with more observations (Phase 2.3). |
| Offline complexity | Start with one “download this view” and a single region; expand later. |
| Paywall friction | Keep free tier genuinely useful (education, previews); paid = clear personalization value (PAYWALL.md). |

---

## 12. Success Metrics (by phase)

- **Phase 0**: Backend live; schema in place; one successful API call from Field View.
- **Phase 1**: N observations submitted (e.g. 10+); form and list working.
- **Phase 2**: Heatmap visible; model v0 doc and pipeline in place.
- **Phase 3**: At least one offline region; layers and sync working.
- **Phase 4**: Species/region/date set; land status + seasonal layer; paywall logic in place.
- **Phase 5**: One export or research summary published; “Data” page live.

---

## 13. Next Step (immediate)

**Recommended next step**: Implement **Phase 0** — pick backend (e.g. Supabase or a small Node+Postgres app), create the observations table from `data-model.md`, add `POST/GET /observations` and minimal auth, then add a single “Submit observation” call from Field View (even if the full form comes in Phase 1). Update `PROJECT_STATE.md` with “Current phase: 0 — Foundation” and “Next step: [your one clear step]”.

After that, move to **Phase 1**: build the full observation form in Field View and wire it to the new API so every observation is stored and visible in “My observations”.

---

*This plan is aligned with PRODUCT.md, data-model.md, and PAYWALL.md. Revisit and adjust after each phase based on usage and priorities.*
