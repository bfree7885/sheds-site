/**
 * Sheds 2.0 — Timing channel (Phase 1).
 * Coarse regional season categories only. Not day-precise cast prediction.
 * Weather must not masquerade as a cast trigger here.
 */
(function (global) {
  "use strict";

  var CATEGORY = Object.freeze({
    EARLY: "early",
    BUILDING: "building",
    PEAK: "peak",
    LATE: "late",
    MOSTLY_PAST: "mostly_past",
    OUTSIDE: "outside",
    UNKNOWN: "unknown"
  });

  var PHASE_TO_CATEGORY = {
    pre_shed: CATEGORY.EARLY,
    early_shed: CATEGORY.BUILDING,
    peak_shed: CATEGORY.PEAK,
    late_shed: CATEGORY.LATE,
    post_shed: CATEGORY.MOSTLY_PAST,
    outside: CATEGORY.OUTSIDE,
    unknown: CATEGORY.UNKNOWN
  };

  var CATEGORY_LABEL = {
    early: "Early",
    building: "Building",
    peak: "Peak",
    late: "Late",
    mostly_past: "Mostly past",
    outside: "Outside primary window",
    unknown: "Unknown"
  };

  /** Phase 4 hunter-facing seasonal answers (no cast-date precision). */
  var CATEGORY_PLAIN = {
    early: "Approaching season",
    building: "Approaching season",
    peak: "Main search window",
    late: "Late season",
    mostly_past: "Late season",
    outside: "Outside main window",
    unknown: "Season timing unclear"
  };

  function getBio() {
    return global.WaypointShedsBiological || null;
  }

  /**
   * @returns {{
   *   channel: 'timing',
   *   category: string,
   *   label: string,
   *   phaseId: string,
   *   phaseLabel: string,
   *   supportLine: string,
   *   why: string[],
   *   limitations: string[],
   *   provenance: 'MODEL_ASSUMPTION'|'WAYPOINT_HEURISTIC',
   *   season: object
   * }}
   */
  function evaluate(opts) {
    opts = opts || {};
    var Bio = getBio();
    var lat = opts.lat;
    var date = opts.date || new Date();
    var prefs = opts.prefs || {};
    if (!Bio || typeof Bio.seasonProfile !== "function") {
      return {
        channel: "timing",
        category: CATEGORY.UNKNOWN,
        label: CATEGORY_LABEL.unknown,
        plainLabel: CATEGORY_PLAIN.unknown,
        phaseId: "unknown",
        phaseLabel: "Unknown",
        supportLine: "Season timing unavailable.",
        why: ["Biological timing module not loaded."],
        limitations: [
          "Cannot estimate regional shed window without the timing model."
        ],
        provenance: "MODEL_ASSUMPTION",
        season: null
      };
    }

    var season = Bio.seasonProfile(date, lat, prefs);
    var category = PHASE_TO_CATEGORY[season.phaseId] || CATEGORY.UNKNOWN;
    var label = CATEGORY_LABEL[category] || CATEGORY_LABEL.unknown;
    var plainLabel = CATEGORY_PLAIN[category] || CATEGORY_PLAIN.unknown;

    var supportLine;
    if (category === CATEGORY.PEAK) {
      supportLine = "Regional photoperiod window is near typical peak casting for this latitude.";
    } else if (category === CATEGORY.BUILDING) {
      supportLine = "Regional window is building — some bucks may cast; many have not.";
    } else if (category === CATEGORY.EARLY) {
      supportLine = "Early for a typical regional shedding window at this latitude.";
    } else if (category === CATEGORY.LATE) {
      supportLine = "Late in the typical regional window — leftover finds possible.";
    } else if (category === CATEGORY.MOSTLY_PAST) {
      supportLine = "Mostly past the typical regional peak — search leftover cover carefully.";
    } else if (category === CATEGORY.OUTSIDE) {
      supportLine = "Outside the primary regional casting window for this latitude.";
    } else {
      supportLine = "Season timing uncertain without a clear latitude context.";
    }

    var why = [
      "Photoperiod drives the antler cycle; latitude shifts the coarse regional window.",
      "Category is a regional heuristic window — not an individual buck cast date."
    ];
    if (season.overridden) {
      why.push("Season phase was user-adjusted and is preference, not established fact.");
    }
    if (typeof season.peakDoy === "number") {
      why.push(
        "Heuristic peak center ≈ day-of-year " +
          season.peakDoy +
          " (± ~" +
          (season.windowHalfDays || "?") +
          " days)."
      );
    }

    return {
      channel: "timing",
      category: category,
      label: label,
      plainLabel: plainLabel,
      phaseId: season.phaseId,
      phaseLabel: season.phase,
      supportLine: supportLine,
      why: why,
      limitations: [
        "Does not predict exact cast dates for individual bucks.",
        "Does not claim herd % cast or find probability.",
        "Age, nutrition, and health can advance or delay casting."
      ],
      provenance: season.overridden ? "WAYPOINT_HEURISTIC" : "MODEL_ASSUMPTION",
      season: season,
      region: season.region || null
    };
  }

  global.WaypointShedsTiming = {
    CATEGORY: CATEGORY,
    CATEGORY_LABEL: CATEGORY_LABEL,
    CATEGORY_PLAIN: CATEGORY_PLAIN,
    evaluate: evaluate
  };
})(typeof window !== "undefined" ? window : globalThis);
