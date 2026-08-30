/**
 * Sheds Phase 3 — Field Plan composer (read-only assembly of existing channels).
 * No route optimization. No find probability.
 */
(function (global) {
  "use strict";

  function countByType(observations) {
    var out = Object.create(null);
    (observations || []).forEach(function (o) {
      if (!o || !o.type) return;
      out[o.type] = (out[o.type] || 0) + 1;
    });
    return out;
  }

  /**
   * @param {object} opts
   * @param {object|null} opts.area - saved Search Area or ephemeral { name, center, radiusM, gisStatus }
   * @param {object|null} opts.timing
   * @param {object|null} opts.habitat - MODEL habitat summary
   * @param {object|null} opts.searchability
   * @param {object|null} opts.evidenceSupport
   * @param {Array} opts.observationsInArea
   * @param {object|null} opts.inspectSuggestion - planner TARGET-like
   * @param {boolean} opts.includeObservationsInHabitat
   * @param {boolean} opts.offline
   * @param {boolean} opts.weatherAvailable
   */
  function build(opts) {
    opts = opts || {};
    var area = opts.area || null;
    var obs = opts.observationsInArea || [];
    var byType = countByType(obs);
    var shedCount = byType.shed_found || 0;
    var habitat = opts.habitat || {
      empty: true,
      label: "Landscape guidance isn’t available for this area yet.",
      channel: "habitat",
      mode: "model"
    };
    var degradations = [];
    if (opts.offline) {
      degradations.push("No network. Live conditions unavailable. Your saved area and field records still work.");
    }
    if (!opts.weatherAvailable) {
      degradations.push("Live conditions unavailable. Timing and local notes still work.");
    }
    if (area && area.gisStatus === "unavailable") {
      degradations.push("No GIS pack for this Search Area — Landscape MODEL empty.");
    }

    return {
      schemaVersion: 1,
      kind: "field_plan",
      area: area
        ? {
            id: area.id || null,
            name: area.name || "Current SEARCH",
            radiusM: area.radiusM || null,
            radiusKey: area.radiusKey || null,
            gisStatus: area.gisStatus || "unknown",
            gisPackId: area.gisPackId || null,
            notes: area.notes || "",
            center: area.center || null
          }
        : null,
      timing: opts.timing || null,
      habitatModel: Object.assign({}, habitat, {
        mode: "model",
        includeObservations: !!opts.includeObservationsInHabitat
      }),
      searchability: opts.searchability || null,
      evidenceSupport: opts.evidenceSupport || null,
      observed: {
        mode: "observed",
        count: obs.length,
        shedsFound: shedCount,
        byType: byType,
        summary:
          obs.length === 0
            ? "No private observations linked to this Search Area yet."
            : obs.length + " observation(s) · " + shedCount + " shed find(s) logged — user-reported, not proof nearby cells hold antlers."
      },
      areasToInspect: opts.inspectSuggestion
        ? {
            ok: true,
            suggestion: opts.inspectSuggestion,
            disclaimer: "Worth inspecting for landscape structure — not a claim that sheds are present."
          }
        : {
            ok: false,
            suggestion: null,
            disclaimer: "No inspect suggestion yet — set SEARCH with Habitat MODEL or add notes."
          },
      userNotes: (area && area.notes) || opts.userNotes || "",
      includeObservationsInHabitat: !!opts.includeObservationsInHabitat,
      degradations: degradations,
      disclaimer:
        "Field Plan is decision support only — Timing / Habitat MODEL / Searchability / Evidence support stay separate. Not a find probability."
    };
  }

  global.WaypointShedsFieldPlan = {
    build: build,
    countByType: countByType
  };
})(typeof window !== "undefined" ? window : globalThis);
