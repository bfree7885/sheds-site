/**
 * Sheds Phase 2 — Habitat GIS scoring (structure + edge + slope + capped observations).
 * Never uses season/weather/SGL/roads as habitat weights.
 */
(function (global) {
  "use strict";

  /** WAYPOINT HEURISTIC weights — not calibrated find rates */
  var W_STRUCTURE = 0.45;
  var W_TERRAIN = 0.25;
  var W_OBSERVED = 0.3;
  var OBS_CAP = 0.35; // single-find hotspot cap (align Phase 1)
  var EDGE_NEAR_M = 90; // ~3 NLCD cells

  var STRUCTURE_SCORE = {
    forest: 0.72,
    wetland: 0.55,
    open: 0.58,
    agriculture: 0.5,
    developed: 0.18,
    water: 0.05,
    other: 0.35,
    unknown: 0.25
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function structureScore(sample) {
    if (!sample) return { score: 0, why: "No land-cover sample." };
    var base = STRUCTURE_SCORE[sample.structure] != null ? STRUCTURE_SCORE[sample.structure] : 0.25;
    var edgeBoost = 0;
    if (sample.edgeM != null && sample.edgeM <= EDGE_NEAR_M && sample.structure !== "water") {
      edgeBoost = 0.18 * (1 - sample.edgeM / EDGE_NEAR_M);
    }
    var score = clamp(base + edgeBoost, 0, 1);
    return {
      score: score,
      base: base,
      edgeBoost: edgeBoost,
      why:
        (sample.structureLabel || sample.structure) +
        (edgeBoost > 0.02 ? " · habitat transition nearby (~" + Math.round(sample.edgeM) + " m)" : "")
    };
  }

  /**
   * Slope as modest walkability / terrain context — not antler likelihood.
   * Prefer moderate slopes; penalize very steep.
   */
  function terrainScore(sample) {
    if (!sample || sample.slopeDeg == null) return { score: 0.4, why: "Slope unavailable." };
    var s = sample.slopeDeg;
    var score;
    var why;
    if (s < 2) {
      score = 0.48;
      why = "Nearly flat terrain (" + s + "°)";
    } else if (s < 12) {
      score = 0.7;
      why = "Moderate slope (" + s + "°) — generally walkable";
    } else if (s < 25) {
      score = 0.45;
      why = "Steeper slope (" + s + "°) — slower walking";
    } else {
      score = 0.22;
      why = "Steep terrain (" + s + "°) — limited walkability";
    }
    return { score: score, slopeDeg: s, why: why };
  }

  function observedScore(lat, lng, observations, Bio) {
    if (!observations || !observations.length || !Bio || !Bio.scoreCell) {
      return { score: 0, why: "No private observations in range." };
    }
    // channelMode:habitat — season/weather excluded; use capped shedBoost (decay-aware).
    var cell = Bio.scoreCell({
      lat: lat,
      lng: lng,
      observations: observations,
      date: new Date(),
      weather: null,
      prefs: {},
      terrain: { source: "unavailable" },
      channelMode: "habitat"
    });
    var boost = cell && cell.parts && cell.parts.shedBoost != null ? cell.parts.shedBoost : 0;
    var cap = Bio.SHED_FIND_INTEREST_CAP != null ? Bio.SHED_FIND_INTEREST_CAP : OBS_CAP;
    var interest = clamp(boost, 0, Math.min(OBS_CAP, cap));
    return {
      score: interest / OBS_CAP, // normalize 0–1 after cap
      cappedInterest: interest,
      why: interest > 0.02 ? "Private observations nearby (capped influence)" : "No private observations in range."
    };
  }

  function bandFrom(score) {
    if (score == null) return { id: "unavailable", label: "Habitat data unavailable for this area" };
    if (score < 0.34) return { id: "limited", label: "Limited habitat signal" };
    if (score < 0.62) return { id: "some", label: "Some habitat signal" };
    return { id: "stronger", label: "Stronger habitat signal" };
  }

  /**
   * Score one lat/lng using GIS sample + optional observations.
   */
  /**
   * Phase 3: includeObservations defaults OFF — MODEL = GIS only unless explicitly enabled.
   */
  function scorePoint(opts) {
    opts = opts || {};
    var sample = opts.sample;
    var includeObs = opts.includeObservations === true;
    if (!sample) {
      return {
        empty: true,
        unavailable: true,
        band: bandFrom(null),
        label: "Habitat data unavailable for this area",
        score: null,
        factors: [],
        why: ["No GIS pack covers this search location."],
        limitations: [
          "Landscape structure does not mean an antler is present.",
          "Season and weather are not used as habitat heat."
        ],
        includeObservations: includeObs,
        mode: includeObs ? "combined" : "model",
        weights: {
          structure: W_STRUCTURE,
          terrain: W_TERRAIN,
          observed: includeObs ? W_OBSERVED : 0,
          class: "WAYPOINT_HEURISTIC"
        }
      };
    }

    var st = structureScore(sample);
    var te = terrainScore(sample);
    var ob = includeObs
      ? observedScore(opts.lat, opts.lng, opts.observations, opts.Bio || global.WaypointShedsBiological)
      : { score: 0, cappedInterest: 0, why: "Observations excluded from Habitat MODEL (toggle off)." };
    var wObs = includeObs ? W_OBSERVED : 0;
    var wStruct = includeObs ? W_STRUCTURE : W_STRUCTURE / (W_STRUCTURE + W_TERRAIN);
    var wTerr = includeObs ? W_TERRAIN : W_TERRAIN / (W_STRUCTURE + W_TERRAIN);
    var score = clamp(wStruct * st.score + wTerr * te.score + wObs * ob.score, 0, 1);
    var band = bandFrom(score);
    var factors = [
      {
        id: "structure",
        label: "Landscape structure",
        value: st.score,
        contribution: wStruct * st.score,
        rationale: st.why,
        class: "WAYPOINT_HEURISTIC",
        source: "NLCD + derived edge"
      },
      {
        id: "terrain",
        label: "Terrain (slope)",
        value: te.score,
        contribution: wTerr * te.score,
        rationale: te.why,
        class: "WAYPOINT_HEURISTIC",
        source: "USGS 3DEP"
      }
    ];
    if (includeObs) {
      factors.push({
        id: "observed",
        label: "Observed evidence",
        value: ob.score,
        contribution: wObs * ob.score,
        rationale: ob.why,
        class: "WAYPOINT_HEURISTIC",
        source: "Private observations (capped)"
      });
    }
    var why = [st.why, te.why];
    if (includeObs) why.push(ob.why);
    else why.push("MODEL only — observations not included in Habitat score.");
    why.push("Not a find probability — landscape inspection guidance only.");
    return {
      empty: false,
      unavailable: false,
      score: score,
      band: band,
      label: band.label,
      structure: st,
      terrain: te,
      observed: ob,
      sample: sample,
      factors: factors,
      why: why,
      includeObservations: includeObs,
      mode: includeObs ? "combined" : "model",
      limitations: [
        "Landscape structure does not mean an antler is present.",
        "Source resolution ~30 m (NLCD) — not meter-precise.",
        "Weights are Waypoint heuristics, not calibrated encounter rates."
      ],
      weights: {
        structure: wStruct,
        terrain: wTerr,
        observed: wObs,
        class: "WAYPOINT_HEURISTIC"
      }
    };
  }

  /**
   * Build rectangular grid of GIS habitat scores inside SEARCH AREA only.
   * Season / weather / SGL / roads must never be passed into scorePoint.
   */
  function buildSearchGrid(opts) {
    opts = opts || {};
    var center = opts.center;
    var radiusM = opts.radiusM || 600;
    var pack = opts.pack;
    var rows = opts.rows || 22;
    var cols = opts.cols || 22;
    var emptyBase = {
      cells: [],
      rows: 0,
      cols: 0,
      bounds: null,
      habitatEmpty: true,
      unavailable: true,
      radiusM: radiusM,
      center: center || null,
      renderMode: "gis-bands",
      modelVersion: "habitat-gis-2.0",
      disclaimer: "Landscape structure guidance — not find probability.",
      coverage: { level: "limited", label: "Habitat data unavailable for this area" }
    };
    if (!center || !pack) {
      return Object.assign({}, emptyBase, { reason: "no-search-or-pack" });
    }
    var Pack = global.WaypointShedsGisPack;
    if (!Pack || !Pack.inBounds(pack, center.lat, center.lng)) {
      return Object.assign({}, emptyBase, {
        reason: "outside-pack",
        coverage: { level: "limited", label: "Habitat data unavailable for this area" }
      });
    }

    var latM = 111320;
    var lonM = 111320 * Math.cos((center.lat * Math.PI) / 180);
    var dLat = radiusM / latM;
    var dLng = radiusM / lonM;
    var bounds = {
      west: center.lng - dLng,
      east: center.lng + dLng,
      south: center.lat - dLat,
      north: center.lat + dLat
    };
    var cells = [];
    var r;
    var c;
    var scoredCount = 0;
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var u = (c + 0.5) / cols;
        var v = (r + 0.5) / rows;
        var lat = bounds.north - v * (bounds.north - bounds.south);
        var lng = bounds.west + u * (bounds.east - bounds.west);
        var dist = haversineM(center.lat, center.lng, lat, lng);
        var outside = dist > radiusM;
        var sample = outside ? null : Pack.sample(pack, lat, lng);
        var scored = outside
          ? null
          : scorePoint({
              sample: sample,
              lat: lat,
              lng: lng,
              observations: opts.observations,
              Bio: opts.Bio,
              includeObservations: opts.includeObservations === true
              /* intentionally omit weather / season / sgl / roads */
            });
        if (scored && !scored.unavailable) scoredCount += 1;
        cells.push({
          row: r,
          col: c,
          lat: lat,
          lng: lng,
          distM: dist,
          outsideArea: outside,
          result: scored,
          priority: scored && scored.score != null ? scored.score : 0,
          band: scored && scored.band ? scored.band.id : "unavailable",
          slopeDeg: sample && sample.slopeDeg != null ? sample.slopeDeg : null,
          habitatEmpty: !scored || !!scored.unavailable || outside
        });
      }
    }
    var support = evidenceSupport({
      unavailable: scoredCount === 0,
      hasStructure: scoredCount > 0,
      hasTerrain: scoredCount > 0,
      hasObservations: !!(opts.includeObservations === true && opts.observations && opts.observations.length)
    });
    return {
      cells: cells,
      rows: rows,
      cols: cols,
      bounds: bounds,
      habitatEmpty: scoredCount === 0,
      unavailable: scoredCount === 0,
      radiusM: radiusM,
      center: center,
      packId: pack.packId,
      packVersion: pack.version,
      cellSizeMApprox: pack.cellSizeMApprox,
      sourceResolutionM: 30,
      renderMode: "gis-bands",
      modelVersion: "habitat-gis-2.0",
      includeObservations: opts.includeObservations === true,
      guidanceMode: opts.includeObservations === true ? "combined" : "model",
      disclaimer: "Landscape structure guidance — not find probability.",
      evidenceSupport: support,
      coverage: {
        level: scoredCount ? "moderate" : "limited",
        label: scoredCount
          ? (opts.includeObservations === true
            ? "GIS pack + optional observations · SEARCH AREA only"
            : "GIS MODEL · ~30 m land cover · SEARCH AREA only")
          : "Habitat data unavailable for this area"
      }
    };
  }

  function haversineM(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function evidenceSupport(opts) {
    opts = opts || {};
    if (opts.unavailable) {
      return {
        level: "Low",
        detail: "No GIS pack for this search area (not find %)",
        meaning: "evidence_support"
      };
    }
    var bits = 0;
    if (opts.hasStructure) bits += 1;
    if (opts.hasTerrain) bits += 1;
    if (opts.hasObservations) bits += 1;
    if (bits >= 3) {
      return {
        level: "Higher",
        detail: "Land cover + terrain + your observations (not find %)",
        meaning: "evidence_support"
      };
    }
    if (bits === 2) {
      return {
        level: "Moderate",
        detail: "Multiple spatial sources (not find %)",
        meaning: "evidence_support"
      };
    }
    if (bits === 1) {
      return {
        level: "Low",
        detail: "Limited spatial sources (not find %)",
        meaning: "evidence_support"
      };
    }
    return {
      level: "Low",
      detail: "Sparse spatial evidence (not find %)",
      meaning: "evidence_support"
    };
  }

  global.WaypointShedsHabitatGis = {
    W_STRUCTURE: W_STRUCTURE,
    W_TERRAIN: W_TERRAIN,
    W_OBSERVED: W_OBSERVED,
    OBS_CAP: OBS_CAP,
    STRUCTURE_SCORE: STRUCTURE_SCORE,
    scorePoint: scorePoint,
    buildSearchGrid: buildSearchGrid,
    evidenceSupport: evidenceSupport,
    bandFrom: bandFrom
  };
})(typeof window !== "undefined" ? window : globalThis);
