/**
 * Sheds V2.0 Phase 1 — Map adapter for Search Priority Today.
 *
 * Thin boundary between existing GIS / V1.3 terrain grids and
 * WaypointShedsSearchPriorityToday. Does not fetch weather or reinvent modifiers.
 */
(function (global) {
  "use strict";

  var BAND_LABELS = Object.freeze({
    stronger_interest: "Stronger search interest",
    moderate_interest: "Moderate search interest",
    lower_interest: "Lower search interest"
  });

  function getModel() {
    return global.WaypointShedsSearchPriorityToday || null;
  }

  function priorityFromTerrainBand(band) {
    if (band === "higher") return "Higher";
    if (band === "moderate") return "Moderate";
    if (band === "lower") return "Lower";
    return null;
  }

  function gisBandOk(id) {
    return id === "stronger" || id === "some" || id === "limited";
  }

  function haversineM(aLat, aLng, bLat, bLng) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (bLat - aLat) * toRad;
    var dLng = (bLng - aLng) * toRad;
    var la1 = aLat * toRad;
    var la2 = bLat * toRad;
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function nearestTerrain(lat, lng, terrainCells, maxM) {
    if (!terrainCells || !terrainCells.length) return null;
    var best = null;
    var bestD = Infinity;
    var i;
    for (i = 0; i < terrainCells.length; i++) {
      var t = terrainCells[i];
      if (!t || t.outsideArea || t.status !== "ready") continue;
      if (t.lat == null || t.lng == null) continue;
      var d = haversineM(lat, lng, t.lat, t.lng);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best && bestD <= (maxM != null ? maxM : 140)) return best;
    return null;
  }

  function adaptGisCell(cell, terrainCells) {
    if (!cell || cell.outsideArea) return null;
    if (!gisBandOk(cell.band)) return null;
    var terrain = nearestTerrain(cell.lat, cell.lng, terrainCells, 140);
    var slope =
      cell.slopeDeg != null
        ? cell.slopeDeg
        : terrain && terrain.slopeDeg != null
          ? terrain.slopeDeg
          : null;
    var out = {
      id: "gis-" + cell.row + "-" + cell.col,
      row: cell.row,
      col: cell.col,
      lat: cell.lat,
      lng: cell.lng,
      gisBand: cell.band,
      slopeDeg: slope
    };
    if (terrain) {
      if (terrain.aspectCardinal) out.aspectCardinal = terrain.aspectCardinal;
      if (terrain.featureKind) out.featureKind = terrain.featureKind;
      if (out.slopeDeg == null && terrain.slopeDeg != null) out.slopeDeg = terrain.slopeDeg;
    }
    return out;
  }

  function adaptTerrainCell(cell) {
    if (!cell || cell.outsideArea || cell.status !== "ready") return null;
    var priority = cell.priorityLabel || priorityFromTerrainBand(cell.band);
    if (!priority) return null;
    return {
      id: "terrain-" + cell.row + "-" + cell.col,
      row: cell.row,
      col: cell.col,
      lat: cell.lat,
      lng: cell.lng,
      terrainPriority: priority,
      aspectCardinal: cell.aspectCardinal || null,
      slopeDeg: cell.slopeDeg != null ? cell.slopeDeg : null,
      featureKind: cell.featureKind || null
    };
  }

  function conditionsFromHuntContext(ctx) {
    if (!ctx || ctx.available === false) return null;
    return {
      freezeThawStatus: ctx.freezeThawStatus || null,
      tempTrendStatus: ctx.tempTrendStatus || null,
      snowCoverStatus: ctx.snowCoverStatus || null,
      seasonCategory: ctx.seasonCategory || null
    };
  }

  function uniqueModifierReasons(areaResult) {
    var seen = {};
    var out = [];
    var rows = (areaResult && areaResult.results) || [];
    var i;
    var j;
    for (i = 0; i < rows.length; i++) {
      var ev = rows[i].evaluation;
      if (!ev || ev.status !== "ready") continue;
      var mods = ev.modifiers || [];
      for (j = 0; j < mods.length; j++) {
        var key = mods[j].id + ":" + mods[j].reason;
        if (seen[key]) continue;
        seen[key] = 1;
        out.push({
          id: mods[j].id,
          reason: mods[j].reason,
          delta: mods[j].delta
        });
      }
    }
    return out;
  }

  function summarize(areaResult, meta) {
    meta = meta || {};
    var rows = (areaResult && areaResult.results) || [];
    var ready = 0;
    var limited = 0;
    var insufficient = 0;
    var bandCounts = {
      stronger_interest: 0,
      moderate_interest: 0,
      lower_interest: 0
    };
    var applied = uniqueModifierReasons(areaResult);
    var i;
    for (i = 0; i < rows.length; i++) {
      var ev = rows[i].evaluation;
      if (!ev) continue;
      if (ev.status === "insufficient_spatial") {
        insufficient += 1;
        continue;
      }
      if (ev.status !== "ready") continue;
      ready += 1;
      if (ev.limited) limited += 1;
      if (ev.band && bandCounts[ev.band] != null) bandCounts[ev.band] += 1;
    }

    var bullets = [];
    if (meta.noActiveSearchArea) {
      bullets.push("Create or select a Search Area to see today's relative search interest.");
    } else if (!ready) {
      bullets.push("Guidance is limited here because usable terrain or habitat inputs are unavailable.");
    } else if (!applied.length) {
      bullets.push("Today's conditions did not materially change the base spatial priority.");
    } else {
      for (i = 0; i < applied.length && i < 4; i++) {
        bullets.push(applied[i].reason);
      }
    }
    if (meta.gisWithoutAspect) {
      bullets.push("Some cells lack aspect, so sun-facing searchability was not applied there.");
    }

    return {
      readyCount: ready,
      limitedCount: limited,
      insufficientCount: insufficient,
      bandCounts: bandCounts,
      appliedModifiers: applied,
      bullets: bullets,
      baseSource: meta.baseSource || null,
      conditionsAvailable: meta.conditionsAvailable !== false,
      noActiveSearchArea: !!meta.noActiveSearchArea
    };
  }

  function emptyInterestGrid(message) {
    return {
      cells: [],
      rows: 0,
      cols: 0,
      bounds: { west: 0, east: 0, south: 0, north: 0 },
      renderMode: "search-interest-today",
      modelVersion: "search-priority-today-2.0.0-phase1",
      habitatEmpty: true,
      unavailable: true,
      disclaimer: message || "No search-interest wash.",
      coverage: { level: "limited", label: message || "Limited guidance" },
      interestSummary: null
    };
  }

  /**
   * Build a heat-layer paint grid from spatial evidence + today's conditions.
   */
  function buildInterestGrid(opts) {
    opts = opts || {};
    var Model = getModel();
    var spatialGrid = opts.spatialGrid || null;
    var terrainGrid = opts.terrainGrid || null;
    var conditions = opts.conditions || null;
    if (opts.huntContext) conditions = conditionsFromHuntContext(opts.huntContext);

    if (!opts.searchLocation) {
      return {
        ok: false,
        reason: "no_search_area",
        grid: emptyInterestGrid("Create or select a Search Area to see today's relative search interest."),
        summary: summarize({ results: [] }, { noActiveSearchArea: true }),
        label: "Search interest today",
        note: "No active Search Area."
      };
    }

    if (!Model) {
      return {
        ok: false,
        reason: "model_missing",
        grid: emptyInterestGrid("Search interest model unavailable."),
        summary: summarize({ results: [] }, {}),
        label: "Search interest today",
        note: "Model module not loaded."
      };
    }

    var terrainCells = terrainGrid && terrainGrid.cells ? terrainGrid.cells : [];
    var modelCells = [];
    var paintIndex = [];
    var baseSource = null;
    var gisWithoutAspect = false;
    var i;

    if (
      spatialGrid &&
      spatialGrid.cells &&
      spatialGrid.cells.length &&
      !spatialGrid.unavailable &&
      !spatialGrid.habitatEmpty
    ) {
      baseSource = "gis";
      for (i = 0; i < spatialGrid.cells.length; i++) {
        var g = spatialGrid.cells[i];
        var adapted = adaptGisCell(g, terrainCells);
        if (!adapted) {
          paintIndex.push({ sourceCell: g, modelIdx: -1 });
          continue;
        }
        if (!adapted.aspectCardinal) gisWithoutAspect = true;
        paintIndex.push({ sourceCell: g, modelIdx: modelCells.length });
        modelCells.push(adapted);
      }
    } else if (terrainCells.length) {
      baseSource = "terrain";
      for (i = 0; i < terrainCells.length; i++) {
        var t = terrainCells[i];
        var tc = adaptTerrainCell(t);
        if (!tc) {
          paintIndex.push({ sourceCell: t, modelIdx: -1 });
          continue;
        }
        paintIndex.push({ sourceCell: t, modelIdx: modelCells.length });
        modelCells.push(tc);
      }
    } else {
      return {
        ok: false,
        reason: "insufficient_spatial",
        grid: emptyInterestGrid("Not enough terrain or habitat evidence for search-interest guidance."),
        summary: summarize({ results: [] }, { baseSource: null }),
        label: "Search interest today",
        note: "Insufficient spatial data — no decorative wash."
      };
    }

    var area = Model.evaluateArea({ cells: modelCells, conditions: conditions });
    if (!area.readyCount) {
      return {
        ok: false,
        reason: "insufficient_spatial",
        grid: emptyInterestGrid("Not enough terrain or habitat evidence for search-interest guidance."),
        summary: summarize(area, { baseSource: baseSource, gisWithoutAspect: gisWithoutAspect }),
        label: "Search interest today",
        note: "Insufficient spatial data — no decorative wash.",
        areaResult: area
      };
    }

    var bounds =
      (spatialGrid && spatialGrid.bounds) ||
      (terrainGrid && terrainGrid.bounds) ||
      null;
    var rows =
      (spatialGrid && spatialGrid.rows) ||
      (terrainGrid && terrainGrid.rows) ||
      0;
    var cols =
      (spatialGrid && spatialGrid.cols) ||
      (terrainGrid && terrainGrid.cols) ||
      0;

    var cells = [];
    for (i = 0; i < paintIndex.length; i++) {
      var slot = paintIndex[i];
      var src = slot.sourceCell || {};
      var ev = slot.modelIdx >= 0 ? area.results[slot.modelIdx].evaluation : null;
      var outside = !!src.outsideArea;
      var band = ev && ev.status === "ready" ? ev.band : null;
      cells.push({
        row: src.row,
        col: src.col,
        lat: src.lat,
        lng: src.lng,
        band: band,
        priority: ev && ev.score != null ? ev.score / 3 : 0,
        outsideArea: outside || !band,
        interest: ev || null,
        status: ev ? ev.status : "insufficient_spatial"
      });
    }

    var condAvailable = !!(
      conditions &&
      (conditions.freezeThawStatus ||
        conditions.tempTrendStatus ||
        conditions.snowCoverStatus ||
        conditions.seasonCategory)
    );

    var summary = summarize(area, {
      baseSource: baseSource,
      gisWithoutAspect: gisWithoutAspect && baseSource === "gis",
      conditionsAvailable: condAvailable
    });

    return {
      ok: true,
      reason: "ready",
      grid: {
        cells: cells,
        rows: rows,
        cols: cols,
        bounds: bounds,
        renderMode: "search-interest-today",
        modelVersion: "search-priority-today-2.0.0-phase1",
        habitatEmpty: false,
        unavailable: false,
        disclaimer: "Relative search interest today — not find probability.",
        coverage: {
          level: summary.limitedCount ? "limited" : "moderate",
          label: summary.limitedCount
            ? "Search interest today · some inputs limited"
            : "Search interest today · condition-aware"
        },
        interestSummary: summary,
        cellMetersApprox:
          (spatialGrid && spatialGrid.cellSizeMApprox) ||
          (terrainGrid && terrainGrid.stepM) ||
          null
      },
      summary: summary,
      areaResult: area,
      label: "Search interest today",
      note:
        baseSource === "gis"
          ? "Habitat base + today's conditions (relative interest, not find %)."
          : "Terrain base + today's conditions (relative interest, not find %)."
    };
  }

  function bandLabel(band) {
    return BAND_LABELS[band] || null;
  }

  global.WaypointShedsSearchPriorityTodayMap = {
    BAND_LABELS: BAND_LABELS,
    adaptGisCell: adaptGisCell,
    adaptTerrainCell: adaptTerrainCell,
    conditionsFromHuntContext: conditionsFromHuntContext,
    buildInterestGrid: buildInterestGrid,
    summarize: summarize,
    bandLabel: bandLabel,
    emptyInterestGrid: emptyInterestGrid
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.WaypointShedsSearchPriorityTodayMap;
  }
})(typeof window !== "undefined" ? window : globalThis);
