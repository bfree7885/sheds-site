/**
 * Sheds — search planner / next-area recommendations (v0.2).
 * Transparent relative guidance. Never implies antlers are present.
 */
(function (global) {
  "use strict";

  function bearingDeg(fromLat, fromLng, toLat, toLng) {
    var toRad = Math.PI / 180;
    var φ1 = fromLat * toRad;
    var φ2 = toLat * toRad;
    var Δλ = (toLng - fromLng) * toRad;
    var y = Math.sin(Δλ) * Math.cos(φ2);
    var x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    var θ = Math.atan2(y, x);
    return (θ * 180 / Math.PI + 360) % 360;
  }

  function compass(bearing) {
    var dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round(bearing / 45) % 8];
  }

  function formatDistance(m) {
    if (!isFinite(m)) return "—";
    if (m < 1000) return Math.round(m) + " m";
    return (m / 1000).toFixed(1) + " km";
  }

  /**
   * @param {object} opts
   * @param {object} opts.grid - from WaypointShedsLikelihood.buildGrid (habitat channel)
   * @param {{lat:number,lng:number}|null} opts.userLatLng
   * @param {object} opts.sessions - WaypointShedsSessions
   * @param {Array} opts.observations
   */
  function plan(opts) {
    opts = opts || {};
    var grid = opts.grid;
    var user = opts.userLatLng;
    var Sessions = opts.sessions || global.WaypointShedsSessions;
    var Model = opts.model || global.WaypointShedsLikelihood;
    var Habitat = global.WaypointShedsHabitat || null;
    var observations = opts.observations || [];

    if (!grid || !grid.cells || !grid.cells.length) {
      return {
        ok: false,
        reason: "Zoom in to build a local habitat surface before planning a next walk.",
        recommendation: null,
        remainingHigh: [],
        coverage: null
      };
    }

    // Phase 1: planner requires habitat signal — never suggest from season wash alone
    var hasHabitat =
      (Habitat && Habitat.hasSpatialEvidence({
        observations: observations,
        terrain: grid.habitatEmpty === false ? { source: "map-derived" } : null
      })) ||
      (grid.habitatEmpty === false &&
        grid.cells.some(function (c) {
          return !c.habitatEmpty && c.priority > 0.05;
        }));

    if (!hasHabitat || grid.habitatEmpty) {
      return {
        ok: false,
        reason:
          "No habitat-specific guidance yet — add private observations (or wait for elevation terrain). Season alone does not suggest a walk target.",
        recommendation: null,
        remainingHigh: [],
        coverage: null,
        habitatRequired: true
      };
    }

    var covMap = Sessions && Sessions.coverageMap ? Sessions.coverageMap() : Object.create(null);
    var scored = grid.cells.map(function (cell) {
      var level = cell.coverageLevel || null;
      if (!level && Sessions && Sessions.cellKey) {
        var hit = covMap[Sessions.cellKey(cell.lat, cell.lng)];
        level = hit ? hit.level : null;
      }
      var plannerScore = cell.habitatEmpty ? 0 : cell.priority;
      if (level === "revisit") plannerScore *= 1.05;
      if (user && Model && Model.haversineM) {
        var dist = Model.haversineM(user.lat, user.lng, cell.lat, cell.lng);
        var distBias = 1;
        if (dist < 40) distBias = 0.55;
        else if (dist < 120) distBias = 0.85;
        else if (dist > 900) distBias = 0.7;
        plannerScore *= distBias;
      }
      return {
        cell: cell,
        coverageLevel: level,
        plannerScore: plannerScore,
        distanceM: user && Model ? Model.haversineM(user.lat, user.lng, cell.lat, cell.lng) : null
      };
    });

    scored.sort(function (a, b) { return b.plannerScore - a.plannerScore; });

    var remainingHigh = scored.filter(function (s) {
      return s.cell.band === "higher" && s.coverageLevel !== "thorough" && !s.cell.habitatEmpty;
    });

    var primary = null;
    var i;
    for (i = 0; i < scored.length; i++) {
      if (scored[i].coverageLevel === "thorough") continue;
      if (scored[i].cell.habitatEmpty || scored[i].plannerScore <= 0) continue;
      primary = scored[i];
      break;
    }

    if (!primary) {
      return {
        ok: false,
        reason: "No habitat-specific walk target in view yet.",
        recommendation: null,
        remainingHigh: [],
        coverage: null,
        habitatRequired: true
      };
    }

    var alts = [];
    for (i = 0; i < scored.length && alts.length < 3; i++) {
      if (primary && scored[i].cell === primary.cell) continue;
      if (scored[i].coverageLevel === "thorough") continue;
      if (scored[i].cell.habitatEmpty || scored[i].plannerScore <= 0) continue;
      if (primary && Model && Model.haversineM) {
        var sep = Model.haversineM(
          primary.cell.lat, primary.cell.lng,
          scored[i].cell.lat, scored[i].cell.lng
        );
        if (sep < 80) continue;
      }
      alts.push(scored[i]);
    }

    var covered = scored.filter(function (s) {
      return s.coverageLevel === "partial" || s.coverageLevel === "thorough";
    }).length;
    var thorough = scored.filter(function (s) { return s.coverageLevel === "thorough"; }).length;
    var searchedShare = scored.length ? covered / scored.length : 0;

    var why = buildWhy(primary, grid, observations, opts);
    var bearing = null;
    var bearingLabel = null;
    if (user && primary) {
      bearing = bearingDeg(user.lat, user.lng, primary.cell.lat, primary.cell.lng);
      bearingLabel = compass(bearing);
    }

    var radiusM = Math.round((grid.cellMetersApprox || 80) * 2.2);
    radiusM = Math.max(60, Math.min(220, radiusM));

    var recommendation = {
      lat: primary.cell.lat,
      lng: primary.cell.lng,
      priority: primary.cell.priority,
      plannerScore: primary.plannerScore,
      band: primary.cell.band,
      coverageLevel: primary.coverageLevel,
      distanceM: primary.distanceM,
      bearingDeg: bearing,
      bearingLabel: bearingLabel,
      suggestedRadiusM: radiusM,
      kind: "search_target",
      walkingHint: bearingLabel
        ? ("Walk roughly " + bearingLabel +
          (primary.distanceM != null ? (" about " + formatDistance(primary.distanceM)) : "") +
          ", then search a ~" + radiusM + " m pocket.")
        : ("Search a ~" + radiusM + " m pocket around the suggested point."),
      why: why,
      explanation: why.join(" "),
      parts: primary.cell.result && primary.cell.result.parts,
      sources: primary.cell.result && primary.cell.result.sources
    };

    return {
      ok: true,
      recommendation: recommendation,
      alternatives: alts.map(function (a) {
        return {
          lat: a.cell.lat,
          lng: a.cell.lng,
          band: a.cell.band,
          priority: a.cell.priority,
          coverageLevel: a.coverageLevel,
          distanceM: a.distanceM
        };
      }),
      remainingHigh: remainingHigh.slice(0, 12).map(function (s) {
        return { lat: s.cell.lat, lng: s.cell.lng, priority: s.cell.priority };
      }),
      remainingHighCount: remainingHigh.length,
      coverage: {
        cellsInView: scored.length,
        searchedCells: covered,
        thoroughCells: thorough,
        searchedShare: searchedShare,
        searchedPercentLabel: Math.round(searchedShare * 100) + "% of visible cells have some search mark",
        note: "Search marks reduce relative walk interest for planning. They do not prove an area is empty of sheds."
      },
      disclaimer:
        "Suggested next walk is habitat guidance from your notes / weak terrain — not a biological hotspot claim and not a find probability."
    };
  }

  function buildWhy(primary, grid, observations, opts) {
    var why = [];
    if (!primary || !primary.cell || !primary.cell.result) {
      return ["Limited model detail for this suggestion."];
    }
    var r = primary.cell.result;
    if (r.explanation) {
      // Prefer biological narrative; keep short for the card.
      var bioLines = String(r.explanation).split(". ").filter(Boolean).map(function (s) {
        return /[.!?]$/.test(s) ? s : s + ".";
      });
      why = bioLines.slice(0, 3);
    }
    var p = r.parts || {};
    if (p.bedding > 0.25) why.push("Influenced by nearby bedding or winter-cover observations.");
    if (p.thermal > 0.25) why.push("Influenced by winter/thermal cover or concentration notes.");
    if (p.feeding > 0.25) why.push("Influenced by nearby feeding-area notes.");
    if (p.deerSign > 0.25) why.push("Influenced by nearby deer sign or sightings.");
    if (p.fences > 0.2) why.push("Influenced by fence-crossing notes (travel pinch).");
    if (p.corridors > 0.25) why.push("Influenced by trail or corridor notes.");
    if (p.shedBoost > 0.15) why.push("Nearby prior shed finds raise local interest without guaranteeing more finds.");
    if (p.humanPressure > 0.2) why.push("Recorded human disturbance reduced attractiveness of the most pressured pocket.");
    if (r.labels && r.labels.seasonPhase) {
      why.push("Seasonal timing heuristic is currently “" + r.labels.seasonPhase + "”.");
    }
    if (primary.coverageLevel === "partial") {
      why.push("Reduced versus untouched ground because this pocket was partially searched.");
    } else if (primary.coverageLevel === "thorough") {
      why.push("Previously marked thoroughly searched — only suggested if little else remains.");
    } else if (primary.coverageLevel === "revisit") {
      why.push("Marked as revisit-later, so it remains eligible in the planner.");
    }
    if (p.searchPenalty > 0.25) {
      why.push("Reduced due to nearby “search completed” observations.");
    }
    if (r.confidence && r.confidence.overallRecommendation != null) {
      why.push("Overall guidance confidence " + r.confidence.overallRecommendation +
        " (not find probability).");
    }
    if (r.sources && r.sources.landCover === "unavailable") {
      why.push("Limited confidence because habitat / land-cover data is incomplete.");
    }
    if (r.sources && r.sources.terrain === "unavailable") {
      why.push("Terrain slope/aspect samples are unavailable for this view.");
    }
    // Dedupe while preserving order
    var seen = Object.create(null);
    why = why.filter(function (line) {
      var k = line.slice(0, 80);
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    }).slice(0, 6);
    if (!why.length) {
      why.push("Chosen mainly from season and terrain settings among higher remaining cells.");
    }
    if (grid && grid.coverage && grid.coverage.label) {
      why.push(grid.coverage.label + " (input coverage, not find certainty).");
    }
    why.push("This does not mean an antler is present.");
    return why;
  }

  global.WaypointShedsPlanner = {
    plan: plan,
    bearingDeg: bearingDeg,
    compass: compass,
    formatDistance: formatDistance
  };
})(window);
