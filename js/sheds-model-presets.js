/**
 * Sheds — model presets (emphasis only; not biological fact).
 */
(function (global) {
  "use strict";

  var PRESETS = {
    balanced: {
      id: "balanced",
      label: "Balanced",
      summary: "Default documented base shares with balanced weights.",
      weights: null,
      seasonPhaseOverride: null
    },
    early_season: {
      id: "early_season",
      label: "Early season",
      summary: "Emphasizes season timing and feeding transitions while soft-pedaling late-winter cover.",
      seasonPhaseOverride: "early_shed",
      weights: { season: "strong", feeding: "strong", thermalCover: "low", corridors: "balanced" }
    },
    peak_shed: {
      id: "peak_shed",
      label: "Peak shed",
      summary: "Emphasizes peak casting window with cover–feed mosaics and corridors.",
      seasonPhaseOverride: "peak_shed",
      weights: { season: "strong", bedding: "strong", thermalCover: "strong", feeding: "strong", corridors: "strong" }
    },
    late_season: {
      id: "late_season",
      label: "Late season",
      summary: "Late-window emphasis; strengthens thermal cover and prior finds interest.",
      seasonPhaseOverride: "late_shed",
      weights: { season: "strong", thermalCover: "strong", shedFinds: "strong", feeding: "balanced" }
    },
    deep_snow: {
      id: "deep_snow",
      label: "Deep snow",
      summary: "Raises snow/weather and thermal/winter cover influence.",
      seasonPhaseOverride: null,
      weights: { snow: "strong", thermalCover: "strong", terrainForm: "low", slope: "low" }
    },
    low_snow: {
      id: "low_snow",
      label: "Low snow",
      summary: "Softens snow influence; leans on edges, corridors, and feeding.",
      seasonPhaseOverride: null,
      weights: { snow: "low", edges: "strong", corridors: "strong", feeding: "strong" }
    },
    feeding_transitions: {
      id: "feeding_transitions",
      label: "Feeding transitions",
      summary: "Emphasizes feeding and edge transition relationship.",
      seasonPhaseOverride: null,
      weights: { feeding: "strong", edges: "strong", corridors: "balanced", bedding: "balanced" }
    },
    bedding_cover: {
      id: "bedding_cover",
      label: "Bedding and cover",
      summary: "Emphasizes bedding, thermal cover, and terrain microforms.",
      seasonPhaseOverride: null,
      weights: { bedding: "strong", thermalCover: "strong", terrainForm: "strong", aspect: "strong" }
    },
    travel_corridors: {
      id: "travel_corridors",
      label: "Travel corridors",
      summary: "Emphasizes corridors and fence pinch points.",
      seasonPhaseOverride: null,
      weights: { corridors: "strong", fences: "strong", terrainForm: "strong", deerSign: "balanced" }
    },
    revisit_planning: {
      id: "revisit_planning",
      label: "Revisit planning",
      summary: "Strengthens search-history and coverage effects for planning next walks.",
      seasonPhaseOverride: null,
      weights: { searchHistory: "strong", shedFinds: "balanced", deerSign: "balanced", humanPressure: "balanced" }
    }
  };

  function listPresets() {
    return Object.keys(PRESETS).map(function (k) { return PRESETS[k]; });
  }

  function getPreset(id) {
    return PRESETS[id] || PRESETS.balanced;
  }

  function applyPreset(prefs, presetId) {
    var base = (global.WaypointShedsObservations && global.WaypointShedsObservations.defaultModelPrefs)
      ? global.WaypointShedsObservations.defaultModelPrefs()
      : { weights: {} };
    var next = {
      schemaVersion: 1,
      heatVisible: prefs && prefs.heatVisible !== false,
      obsVisible: prefs && prefs.obsVisible !== false,
      coverageVisible: prefs && prefs.coverageVisible !== false,
      showConfidence: !!(prefs && prefs.showConfidence),
      diagnosticMode: !!(prefs && prefs.diagnosticMode),
      compareMode: !!(prefs && prefs.compareMode),
      includeObservationsInHabitat: !!(prefs && prefs.includeObservationsInHabitat),
      searchAreasVisible: !!(prefs && prefs.searchAreasVisible),
      opacity: prefs && typeof prefs.opacity === "number" ? prefs.opacity : 0.55,
      seasonPhaseOverride: null,
      activePreset: presetId || "balanced",
      weights: Object.assign({}, base.weights, (prefs && prefs.weights) || {})
    };
    var preset = getPreset(presetId || "balanced");
    if (preset.weights) {
      Object.keys(preset.weights).forEach(function (k) {
        next.weights[k] = preset.weights[k];
      });
    } else {
      next.weights = Object.assign({}, base.weights);
    }
    next.seasonPhaseOverride = preset.seasonPhaseOverride;
    next.activePreset = preset.id;
    return next;
  }

  function changedWeightKeys(before, after) {
    before = (before && before.weights) || {};
    after = (after && after.weights) || {};
    var keys = {};
    Object.keys(before).forEach(function (k) { keys[k] = 1; });
    Object.keys(after).forEach(function (k) { keys[k] = 1; });
    return Object.keys(keys).filter(function (k) {
      return before[k] !== after[k];
    });
  }

  global.WaypointShedsPresets = {
    PRESETS: PRESETS,
    listPresets: listPresets,
    getPreset: getPreset,
    applyPreset: applyPreset,
    changedWeightKeys: changedWeightKeys
  };
})(typeof window !== "undefined" ? window : globalThis);
