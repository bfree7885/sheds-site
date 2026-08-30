/**
 * Sheds 2.0 — Habitat / where-to-walk channel (Phase 1).
 * Spatial interest from private observations + optional weak elev/terrain heuristics.
 * Season and weather must NOT paint habitat heat.
 * Empty when no meaningful spatial evidence.
 */
(function (global) {
  "use strict";

  var EMPTY_MESSAGE = "No habitat-specific guidance yet";
  var EMPTY_DETAIL =
    "Add private observations (or wait for elevation terrain) — season and weather alone do not paint where to walk.";

  function getBio() {
    return global.WaypointShedsBiological || null;
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function hasObservationEvidence(observations) {
    if (!observations || !observations.length) return false;
    var spatialTypes = {
      feeding_area: 1,
      bedding_area: 1,
      winter_concentration: 1,
      trail_crossing: 1,
      fence_crossing: 1,
      deer_sign: 1,
      deer_seen: 1,
      shed_found: 1,
      habitat_note: 1,
      hunting_pressure: 1,
      hiking_pressure: 1,
      human_disturbance: 1,
      access_issue: 1,
      search_completed: 1
    };
    var i;
    for (i = 0; i < observations.length; i++) {
      var o = observations[i];
      if (o && o.location && spatialTypes[o.type]) return true;
    }
    return false;
  }

  function hasTerrainEvidence(terrain) {
    if (!terrain || terrain.source !== "map-derived") return false;
    return terrain.slope != null || (terrain.morphology && terrain.morphology.source === "map-derived");
  }

  /**
   * True when Phase 1 may show non-empty habitat guidance / heat.
   */
  function hasSpatialEvidence(opts) {
    opts = opts || {};
    return hasObservationEvidence(opts.observations) || hasTerrainEvidence(opts.terrain);
  }

  /**
   * Score habitat interest for one cell. Excludes season timing and weather.
   * Caps prior-find hotspot implication.
   */
  function scoreCell(opts) {
    opts = opts || {};
    var Bio = getBio();
    var empty = !hasSpatialEvidence(opts);
    if (empty) {
      return {
        channel: "habitat",
        empty: true,
        interest: null,
        band: "neutral",
        label: EMPTY_MESSAGE,
        detail: EMPTY_DETAIL,
        factors: [],
        why: [EMPTY_DETAIL],
        limitations: [
          "No land-cover / GIS habitat layers in Phase 1.",
          "Season and weather are not used as spatial habitat heat."
        ],
        provenance: [],
        weakTerrain: false
      };
    }

    if (!Bio || typeof Bio.scoreCell !== "function") {
      return {
        channel: "habitat",
        empty: true,
        interest: null,
        band: "neutral",
        label: EMPTY_MESSAGE,
        detail: "Habitat scorer unavailable.",
        factors: [],
        why: ["Biological model not loaded."],
        limitations: ["Cannot score habitat without the model."],
        provenance: [],
        weakTerrain: false
      };
    }

    // Delegate to Bio habitatInterest path (season/weather excluded from spatial).
    var scored = Bio.scoreCell(
      Object.assign({}, opts, {
        channelMode: "habitat",
        excludeSeasonFromSpatial: true,
        excludeWeatherFromSpatial: true
      })
    );

    var interest =
      scored.habitatInterest != null ? scored.habitatInterest : scored.priority;
    var weakTerrain =
      hasTerrainEvidence(opts.terrain) && !hasObservationEvidence(opts.observations);

    var why = [];
    if (hasObservationEvidence(opts.observations)) {
      why.push("Relative walk interest from your private observations (kernels).");
    }
    if (weakTerrain) {
      why.push(
        "Weak elev/terrain heuristic only (slope/aspect/microform) — labeled weak, not GIS habitat."
      );
    }
    if ((scored.parts && scored.parts.shedBoost) > 0.15) {
      why.push(
        "Prior-find interest is capped — a past find is not a guarantee of more antlers."
      );
    }

    var band = "lower";
    if (interest == null) band = "neutral";
    else if (interest >= 0.72) band = "higher";
    else if (interest >= 0.45) band = "moderate";

    return {
      channel: "habitat",
      empty: false,
      interest: interest,
      band: band,
      label: weakTerrain
        ? "Weak terrain cue (labeled)"
        : "Your observations / terrain cues",
      detail: weakTerrain
        ? "Coarse elevation proxies only — not land-cover intelligence."
        : "Private notes and optional weak elev heuristics — not antler GPS.",
      factors: (scored.habitatFactors || scored.factors || []).filter(function (f) {
        return f.id !== "season_timing";
      }),
      why: why,
      limitations: [
        "Not a map of where sheds exist.",
        "No NLCD / forest-edge GIS in Phase 1.",
        "Prior finds are soft interest only and capped."
      ],
      provenance: [
        hasObservationEvidence(opts.observations)
          ? { factor: "observations", class: "SOURCE_FACT" }
          : null,
        weakTerrain
          ? { factor: "elev_terrain", class: "WAYPOINT_HEURISTIC" }
          : null
      ].filter(Boolean),
      weakTerrain: weakTerrain,
      bioResult: scored
    };
  }

  /**
   * Grid helper: mark cells empty/neutral when no spatial evidence in context.
   */
  function annotateGridCell(cell, habitat) {
    if (!cell) return cell;
    if (!habitat || habitat.empty) {
      cell.habitatEmpty = true;
      cell.priority = 0;
      cell.habitatInterest = null;
      cell.band = "neutral";
      cell.layerKind = "habitat-empty";
      return cell;
    }
    cell.habitatEmpty = false;
    cell.habitatInterest = habitat.interest;
    cell.priority = habitat.interest != null ? habitat.interest : 0;
    cell.band = habitat.band;
    cell.layerKind = habitat.weakTerrain ? "habitat-weak-terrain" : "habitat-observed";
    cell.weakTerrain = !!habitat.weakTerrain;
    return cell;
  }

  function emptyState() {
    return {
      channel: "habitat",
      empty: true,
      interest: null,
      band: "neutral",
      label: EMPTY_MESSAGE,
      detail: EMPTY_DETAIL
    };
  }

  global.WaypointShedsHabitat = {
    EMPTY_MESSAGE: EMPTY_MESSAGE,
    EMPTY_DETAIL: EMPTY_DETAIL,
    hasSpatialEvidence: hasSpatialEvidence,
    hasObservationEvidence: hasObservationEvidence,
    hasTerrainEvidence: hasTerrainEvidence,
    scoreCell: scoreCell,
    annotateGridCell: annotateGridCell,
    emptyState: emptyState,
    clamp: clamp
  };
})(typeof window !== "undefined" ? window : globalThis);
