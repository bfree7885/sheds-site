/**
 * Sheds V2.0 Phase 1 — Search Priority Today (pure model foundation).
 *
 * Relative search interest inside a Search Area from:
 *   base spatial priority (GIS band OR V1.3 terrain priority)
 *   + condition × spatial modifiers
 *
 * NOT wired to production map rendering.
 * NOT shed/find probability. No network. Deterministic.
 *
 * Spec: docs/sheds/SHEDS-V2-0-PHASE1-SEARCH-PRIORITY-TODAY.md
 */
(function (global) {
  "use strict";

  var VERSION = "2.0.0-phase1";

  var BANDS = Object.freeze([
    "stronger_interest",
    "moderate_interest",
    "lower_interest"
  ]);

  var SOUTHISH = { S: 1, SE: 1, SW: 1 };
  var BENCHISH = { bench: 1, gentle: 1, transition: 1 };
  var STEEPISH = { steep: 1 };

  var BANNED_RE =
    /shed probability|find probability|chance of finding|hotspot|likely shed|sheds are here|deer are here|\d+\s*%|0\.\d{2}\s*probability/i;

  function finiteNum(n) {
    return typeof n === "number" && isFinite(n);
  }

  function baseScoreFromGis(bandId) {
    if (bandId === "stronger") return 2;
    if (bandId === "some") return 1;
    if (bandId === "limited") return 0;
    return null;
  }

  function baseScoreFromTerrain(priority) {
    if (priority === "Higher") return 2;
    if (priority === "Moderate") return 1;
    if (priority === "Lower") return 0;
    return null;
  }

  function bandFromScore(score) {
    if (!finiteNum(score)) return null;
    // Relative communication bands on the 0–3 relative score — not probability.
    // Base Moderate/some (1) → moderate; Higher/stronger (2) or boosted → stronger; 0 → lower.
    if (score >= 2) return "stronger_interest";
    if (score >= 1) return "moderate_interest";
    return "lower_interest";
  }

  function normalizeConditions(raw) {
    raw = raw || {};
    var snow = raw.snowCoverStatus || raw.snowStatus || null;
    var ft = raw.freezeThawStatus || null;
    var trend = raw.tempTrendStatus || null;
    var season = raw.seasonCategory || null;
    var known = {
      snow: snow != null && snow !== "unavailable" && snow !== "unknown",
      freezeThaw: ft != null && ft !== "insufficient" && ft !== "unknown",
      tempTrend: trend != null && trend !== "unknown",
      season: season != null && season !== "unknown"
    };
    return {
      snowCoverStatus: known.snow ? snow : null,
      freezeThawStatus: known.freezeThaw ? ft : null,
      tempTrendStatus: known.tempTrend ? trend : null,
      seasonCategory: known.season ? season : null,
      available: !!(known.snow || known.freezeThaw || known.tempTrend || known.season),
      known: known
    };
  }

  function resolveBase(cell) {
    cell = cell || {};
    var gisBand = cell.gisBand || null;
    var gisScore = baseScoreFromGis(gisBand);
    if (gisScore != null) {
      return {
        source: "gis",
        label: gisBand,
        score: gisScore
      };
    }
    var terrain = cell.terrainPriority || cell.priority || null;
    var tScore = baseScoreFromTerrain(terrain);
    if (tScore != null) {
      return {
        source: "terrain",
        label: terrain,
        score: tScore
      };
    }
    return { source: "none", label: null, score: null };
  }

  function isSouthish(cardinal) {
    return !!(cardinal && SOUTHISH[cardinal]);
  }

  /**
   * Condition × spatial modifiers. Each must change relative WHERE.
   * Returns { modifiers, limited }.
   */
  function collectModifiers(cell, conditions) {
    var modifiers = [];
    var limited = false;
    cell = cell || {};
    conditions = conditions || {};

    if (!conditions.available) {
      return { modifiers: modifiers, limited: true };
    }

    var aspect = cell.aspectCardinal || null;
    var kind = (cell.feature && cell.feature.kind) || cell.featureKind || null;
    var slope = finiteNum(cell.slopeDeg) ? cell.slopeDeg : null;

    // solar_searchability: freeze/thaw or warming × southish aspect
    var solarTrigger =
      conditions.freezeThawStatus === "freeze_thaw" ||
      conditions.tempTrendStatus === "warming";
    if (solarTrigger) {
      if (!aspect || slope == null || slope < 2) {
        limited = true;
      } else if (isSouthish(aspect)) {
        modifiers.push({
          id: "solar_searchability",
          delta: 1,
          reason:
            "Sun-facing ground can become more searchable sooner during thaw or warming (searchability, not a find claim)."
        });
      }
    }

    // snow_practicality: limiting/deep snow × steep vs bench/gentle
    var snow = conditions.snowCoverStatus;
    if (snow === "limiting" || snow === "deep") {
      if (!kind) {
        limited = true;
      } else if (STEEPISH[kind]) {
        modifiers.push({
          id: "snow_practicality",
          delta: -1,
          reason:
            "Limiting snow on steep ground usually reduces practical search effort versus gentler structure nearby."
        });
      } else if (BENCHISH[kind]) {
        modifiers.push({
          id: "snow_practicality",
          delta: 1,
          reason:
            "Gentler benches/transitions are relatively more practical to search when snow is limiting."
        });
      }
    } else if (snow == null) {
      // unknown snow — do not invent practicality shifts
      if (conditions.known && conditions.known.snow === false) limited = true;
    }

    return { modifiers: modifiers, limited: limited };
  }

  function clampScore(n) {
    if (!finiteNum(n)) return null;
    if (n < 0) return 0;
    if (n > 3) return 3;
    return Math.round(n * 100) / 100;
  }

  /**
   * Evaluate one cell/zone.
   *
   * @param {object} opts
   * @param {object} opts.cell
   * @param {object} [opts.conditions] derived condition snapshot fields
   */
  function evaluateCell(opts) {
    opts = opts || {};
    var cell = opts.cell || {};
    var conditions = normalizeConditions(opts.conditions);
    var base = resolveBase(cell);

    if (base.score == null) {
      return {
        version: VERSION,
        status: "insufficient_spatial",
        band: null,
        score: null,
        base: base,
        modifiers: [],
        reasons: ["Insufficient spatial priority (no GIS band or terrain priority)."],
        inputsUsed: [],
        limited: true,
        flags: {
          insufficientSpatial: true,
          conditionsAvailable: conditions.available
        }
      };
    }

    var collected = collectModifiers(cell, conditions);
    var score = base.score;
    var reasons = [];
    var inputsUsed = ["base:" + base.source];
    reasons.push(
      "Base " +
        (base.source === "gis" ? "habitat GIS band" : "terrain priority") +
        ": " +
        base.label +
        "."
    );

    var i;
    for (i = 0; i < collected.modifiers.length; i++) {
      score += collected.modifiers[i].delta;
      reasons.push(collected.modifiers[i].reason);
      inputsUsed.push("modifier:" + collected.modifiers[i].id);
    }

    if (conditions.available) {
      if (conditions.freezeThawStatus) inputsUsed.push("condition:freezeThaw");
      if (conditions.tempTrendStatus) inputsUsed.push("condition:tempTrend");
      if (conditions.snowCoverStatus) inputsUsed.push("condition:snowCover");
      if (conditions.seasonCategory) inputsUsed.push("condition:season");
    }

    score = clampScore(score);
    var band = bandFromScore(score);

    return {
      version: VERSION,
      status: "ready",
      band: band,
      score: score,
      base: base,
      modifiers: collected.modifiers.slice(),
      reasons: reasons,
      inputsUsed: inputsUsed,
      limited: collected.limited || !conditions.available,
      flags: {
        insufficientSpatial: false,
        conditionsAvailable: conditions.available,
        conditionsLimited: collected.limited || !conditions.available
      }
    };
  }

  /**
   * Evaluate many cells (Search Area). Pure / deterministic.
   */
  function evaluateArea(opts) {
    opts = opts || {};
    var cells = opts.cells || [];
    var conditions = opts.conditions || null;
    var results = [];
    var i;
    for (i = 0; i < cells.length; i++) {
      var cell = cells[i] || {};
      var ev = evaluateCell({ cell: cell, conditions: conditions });
      results.push({
        id: cell.id != null ? cell.id : String(i),
        evaluation: ev
      });
    }
    return {
      version: VERSION,
      results: results,
      readyCount: results.filter(function (r) {
        return r.evaluation.status === "ready";
      }).length
    };
  }

  function orderingKey(areaResult) {
    return (areaResult.results || [])
      .map(function (r) {
        return r.id + ":" + (r.evaluation.score != null ? r.evaluation.score : "x");
      })
      .join("|");
  }

  function containsBannedLanguage(text) {
    return BANNED_RE.test(String(text || ""));
  }

  function assertHonestOutput(ev) {
    var blob = JSON.stringify(ev || {});
    return !containsBannedLanguage(blob);
  }

  var api = {
    VERSION: VERSION,
    BANDS: BANDS,
    evaluateCell: evaluateCell,
    evaluateArea: evaluateArea,
    orderingKey: orderingKey,
    bandFromScore: bandFromScore,
    normalizeConditions: normalizeConditions,
    containsBannedLanguage: containsBannedLanguage,
    assertHonestOutput: assertHonestOutput
  };

  global.WaypointShedsSearchPriorityToday = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
