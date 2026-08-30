/**
 * Sheds — habitat-interest grid wrapper (Phase 1 prediction truth).
 * Scoring delegates to Whitetail Biological Model habitat channel.
 * Deterministic. Explainable. Never claims "probability of finding an antler."
 * Season/weather do not paint spatial heat when habitat evidence is absent.
 */
(function (global) {
  "use strict";

  var Bio = null;

  function getBio() {
    if (!Bio) Bio = global.WaypointShedsBiological || null;
    return Bio;
  }

  function getHabitat() {
    return global.WaypointShedsHabitat || null;
  }

  var WEIGHT_SCALE = {
    off: 0,
    low: 0.45,
    balanced: 1,
    strong: 1.65
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function haversineM(aLat, aLng, bLat, bLng) {
    var B = getBio();
    if (B && B.haversineM) return B.haversineM(aLat, aLng, bLat, bLng);
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (bLat - aLat) * toRad;
    var dLng = (bLng - aLng) * toRad;
    var lat1 = aLat * toRad;
    var lat2 = bLat * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function weightOf(prefs, key) {
    var B = getBio();
    if (B && B.weightOf) return B.weightOf(prefs, key);
    var w = (prefs && prefs.weights && prefs.weights[key]) || "balanced";
    return WEIGHT_SCALE[w] != null ? WEIGHT_SCALE[w] : 1;
  }

  function seasonProfile(date, lat) {
    var B = getBio();
    if (B && B.seasonProfile) return B.seasonProfile(date, lat);
    return {
      score: 0.5,
      phase: "unknown",
      source: "unavailable",
      note: "Biological model not loaded."
    };
  }

  function elevationIndex(grid, row, col, rows, cols) {
    if (!grid || !grid.length) return null;
    var i = row * cols + col;
    if (i < 0 || i >= grid.length) return null;
    var e = grid[i];
    return typeof e === "number" && isFinite(e) ? e : null;
  }

  function slopeAspectAt(grid, row, col, rows, cols, cellM) {
    var c = elevationIndex(grid, row, col, rows, cols);
    var n = elevationIndex(grid, row - 1, col, rows, cols);
    var s = elevationIndex(grid, row + 1, col, rows, cols);
    var w = elevationIndex(grid, row, col - 1, rows, cols);
    var e = elevationIndex(grid, row, col + 1, rows, cols);
    if (c == null || n == null || s == null || w == null || e == null) {
      return { slope: null, aspect: null, source: "unavailable" };
    }
    var dzdy = (s - n) / (2 * cellM);
    var dzdx = (e - w) / (2 * cellM);
    var slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
    var slopeDeg = slopeRad * 180 / Math.PI;
    var aspect = (Math.atan2(-dzdx, dzdy) * 180 / Math.PI + 360) % 360;
    var terrain = { slope: slopeDeg, aspect: aspect, elev: c, source: "map-derived" };
    var B = getBio();
    if (B && B.terrainMorphologyAt) {
      terrain.morphology = B.terrainMorphologyAt(grid, row, col, rows, cols);
    }
    return terrain;
  }

  function coverageFrom(inputs) {
    var present = 0;
    var total = 0;
    var keys = ["season", "terrain", "observations", "weather"];
    keys.forEach(function (k) {
      total += 1;
      if (inputs[k] && inputs[k] !== "unavailable") present += 1;
    });
    var ratio = present / total;
    if (ratio >= 0.75) return { level: "strong", label: "Stronger input coverage" };
    if (ratio >= 0.45) return { level: "moderate", label: "Moderate input coverage" };
    return { level: "limited", label: "Limited input coverage" };
  }

  function scoreCell(opts) {
    var B = getBio();
    if (!B || !B.scoreCell) {
      return {
        priority: 0,
        habitatInterest: null,
        band: "neutral",
        habitatEmpty: true,
        parts: {},
        labels: {},
        sources: { season: "unavailable", terrain: "unavailable", observations: "unavailable", weather: "unavailable", landCover: "unavailable" },
        explanation: "Biological model unavailable."
      };
    }
    var Habitat = getHabitat();
    var scoreOpts = Object.assign({}, opts, {
      channelMode: "habitat",
      excludeSeasonFromSpatial: true,
      excludeWeatherFromSpatial: true
    });
    if (Habitat && !Habitat.hasSpatialEvidence(scoreOpts)) {
      return {
        priority: 0,
        habitatInterest: null,
        band: "neutral",
        habitatEmpty: true,
        channelMode: "habitat",
        parts: {},
        labels: {},
        sources: {
          season: "excluded-from-habitat",
          terrain: (opts.terrain && opts.terrain.source) || "unavailable",
          observations: "unavailable",
          weather: "excluded-from-habitat",
          landCover: "unavailable"
        },
        explanation: Habitat.EMPTY_DETAIL || "No habitat-specific guidance yet.",
        honesty: { priorityIsNotFindProbability: true, habitatExcludesSeasonWeather: true }
      };
    }
    var scored = B.scoreCell(scoreOpts);
    scored.habitatEmpty = false;
    if (scored.habitatInterest != null) scored.priority = scored.habitatInterest;
    return scored;
  }

  function explain(result, extras) {
    extras = extras || {};
    var B = getBio();
    var text = B && B.explain ? B.explain(result) : (result && result.explanation) || "No model result.";
    if (extras.coverage && extras.coverage.label) {
      text += " " + extras.coverage.label + " (data coverage, not find certainty).";
    }
    return text;
  }

  function buildGrid(bounds, rows, cols, context) {
    context = context || {};
    rows = rows || 20;
    cols = cols || 20;
    var west = bounds.getWest();
    var east = bounds.getEast();
    var south = bounds.getSouth();
    var north = bounds.getNorth();
    var elev = context.elevations || null;
    var midLat = (south + north) / 2;
    var cellM = haversineM(midLat, west, midLat, west + (east - west) / cols) || 80;
    var cells = [];
    var r;
    var c;
    var Sessions = context.sessions || global.WaypointShedsSessions;
    var covMap = Sessions && Sessions.coverageMap ? Sessions.coverageMap() : null;
    var Habitat = getHabitat();
    var coverageProbe = {
      season: "timing-separate",
      terrain: elev ? "map-derived" : "unavailable",
      observations: (context.observations && context.observations.length) ? "user-observation" : "unavailable",
      weather: "searchability-separate"
    };
    var coverage = coverageFrom(coverageProbe);
    var B = getBio();

    // Viewport-level empty: no observations and no elevation → honest blank heat
    var viewportHasEvidence = false;
    if (Habitat) {
      viewportHasEvidence = Habitat.hasObservationEvidence(context.observations) || !!elev;
    } else {
      viewportHasEvidence = !!(context.observations && context.observations.length) || !!elev;
    }

    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var lat = north - (r + 0.5) * (north - south) / rows;
        var lng = west + (c + 0.5) * (east - west) / cols;
        var terrain = elev
          ? slopeAspectAt(elev, r, c, rows, cols, cellM)
          : { slope: null, aspect: null, morphology: { source: "unavailable" }, source: "unavailable" };
        var covLevel = null;
        var covFactor = 1;
        if (covMap && Sessions && Sessions.cellKey) {
          var hit = covMap[Sessions.cellKey(lat, lng)];
          if (hit) {
            covLevel = hit.level;
            covFactor = Sessions.coveragePenaltyFactor(hit.level);
          }
        }
        var scored;
        if (!viewportHasEvidence) {
          scored = {
            priority: 0,
            habitatInterest: null,
            band: "neutral",
            habitatEmpty: true,
            explanation: Habitat
              ? Habitat.EMPTY_DETAIL
              : "No habitat-specific guidance yet."
          };
        } else {
          scored = scoreCell({
            lat: lat,
            lng: lng,
            date: context.date,
            prefs: context.prefs,
            observations: context.observations,
            terrain: terrain,
            weather: null, // weather never paints habitat heat
            edgeHint: context.edgeHint,
            landCoverCategory: context.landCoverCategory,
            coverageLevel: covLevel,
            coverageFactor: covFactor,
            offlineForced: context.offlineForced,
            terrainCacheState: context.terrainCacheState,
            cellMetersApprox: Math.round(cellM),
            nowMs: context.nowMs
          });
        }
        cells.push({
          row: r,
          col: c,
          lat: lat,
          lng: lng,
          priority: scored.habitatEmpty ? 0 : (scored.habitatInterest != null ? scored.habitatInterest : scored.priority),
          habitatInterest: scored.habitatInterest,
          habitatEmpty: !!scored.habitatEmpty,
          biologicalSuitability: scored.biologicalSuitability,
          band: scored.band,
          coverageLevel: covLevel,
          layerKind: scored.habitatEmpty
            ? "habitat-empty"
            : (Habitat && Habitat.hasObservationEvidence(context.observations)
              ? "habitat-observed"
              : "habitat-weak-terrain"),
          result: scored
        });
      }
    }

    var emptyCount = cells.filter(function (cell) { return cell.habitatEmpty; }).length;
    return {
      rows: rows,
      cols: cols,
      bounds: { west: west, east: east, south: south, north: north },
      cellMetersApprox: Math.round(cellM),
      coverage: coverage,
      cells: cells,
      habitatEmpty: !viewportHasEvidence || emptyCount === cells.length,
      habitatMode: "habitat-only",
      speciesId: "odocoileus-virginianus",
      modelVersion: B ? B.MODEL_VERSION : null,
      disclaimer:
        "Habitat walk-interest from private notes and optional weak elev heuristics only. " +
        "Season and weather do not paint this surface. Not a probability of finding sheds."
    };
  }

  function bandLabel(band) {
    if (band === "higher") return "Higher walk interest";
    if (band === "moderate") return "Moderate walk interest";
    if (band === "neutral") return "No habitat guidance";
    return "Lower walk interest";
  }

  global.WaypointShedsLikelihood = {
    WEIGHT_SCALE: WEIGHT_SCALE,
    seasonProfile: seasonProfile,
    scoreCell: scoreCell,
    explain: explain,
    buildGrid: buildGrid,
    coverageFrom: coverageFrom,
    bandLabel: bandLabel,
    haversineM: haversineM,
    weightOf: weightOf,
    slopeAspectAt: slopeAspectAt
  };
})(typeof window !== "undefined" ? window : globalThis);
