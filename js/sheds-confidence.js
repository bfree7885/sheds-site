/**
 * Sheds 2.0 — Confidence channel (Phase 1).
 * Evidence-support for guidance only: Low / Moderate / High.
 * NOT chance of finding a shed. No confidence theater.
 */
(function (global) {
  "use strict";

  var LEVEL = Object.freeze({
    LOW: "Low",
    MODERATE: "Moderate",
    HIGH: "High"
  });

  /**
   * Documented rules (Phase 1):
   * - Start Moderate when timing + at least one live env input exist.
   * - Drop to Low when: weather failed, no habitat evidence, timing only/coarse,
   *   or multiple missing inputs.
   * - High only when: habitat observations present AND weather ready AND terrain
   *   OR strong observation density — still labeled “support for guidance.”
   */
  function evaluate(opts) {
    opts = opts || {};
    var reasons = [];
    var missing = 0;

    var timing = opts.timing || null;
    var habitat = opts.habitat || null;
    var searchability = opts.searchability || null;
    var weatherStatus = opts.weatherStatus || "unavailable";
    var envFailed = opts.envFailed === true || weatherStatus === "unavailable";
    var elevFailed = opts.elevFailed === true;

    if (!timing || timing.category === "unknown" || timing.category === "outside") {
      missing += 1;
      reasons.push("Timing is coarse, outside window, or unknown.");
    }
    if (!habitat || habitat.empty) {
      missing += 1;
      reasons.push("No habitat-specific spatial evidence yet.");
    }
    if (envFailed) {
      missing += 1;
      reasons.push("Weather/environment input failed or unavailable.");
    }
    if (elevFailed && habitat && !habitat.empty && habitat.weakTerrain) {
      missing += 1;
      reasons.push("Elevation/terrain failed — weak terrain cues incomplete.");
    }
    if (
      searchability &&
      (searchability.status === "unavailable" ||
        searchability.status === "weather_unavailable")
    ) {
      missing += 1;
      reasons.push("Searchability briefing degraded without weather.");
    }

    var hasObs =
      habitat &&
      !habitat.empty &&
      habitat.provenance &&
      habitat.provenance.some(function (p) {
        return p.factor === "observations";
      });

    var level = LEVEL.MODERATE;
    if (missing >= 2 || (!hasObs && envFailed)) {
      level = LEVEL.LOW;
    } else if (
      hasObs &&
      weatherStatus === "ready" &&
      timing &&
      (timing.category === "peak" ||
        timing.category === "building" ||
        timing.category === "late") &&
      missing === 0
    ) {
      level = LEVEL.HIGH;
    } else if (missing >= 1) {
      level = LEVEL.LOW;
    }

    // Cap High theater: if only coarse timing + weather, never High.
    if (level === LEVEL.HIGH && (!habitat || habitat.empty)) {
      level = LEVEL.MODERATE;
      reasons.push("High confidence blocked — habitat evidence required.");
    }

    if (!reasons.length) {
      reasons.push("Inputs cover timing, habitat notes, and search conditions.");
    }

    return {
      channel: "confidence",
      level: level,
      label: level,
      why: reasons.slice(0, 5),
      missingInputCount: missing,
      limitations: [
        "Confidence is evidence support for guidance — not probability of finding a shed.",
        "High never means certainty that antlers are present."
      ],
      provenance: "WAYPOINT_HEURISTIC"
    };
  }

  global.WaypointShedsConfidence = {
    LEVEL: LEVEL,
    evaluate: evaluate
  };
})(typeof window !== "undefined" ? window : globalThis);
