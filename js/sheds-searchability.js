/**
 * Sheds 2.0 — Searchability channel (Phase 1).
 * Field conditions for looking: precip, snow/cover if known, footing, visibility,
 * severe weather, daylight. Weather belongs primarily here — not as cast trigger.
 */
(function (global) {
  "use strict";

  var DISCLAIMER =
    "Searchability answers “Is today a good day to go search?” — " +
    "not whether deer are more likely to drop antlers today.";

  function getTodays() {
    return global.WaypointShedsTodaysSearch || null;
  }

  function snowStatus(weather) {
    var wx = weather || {};
    if (typeof wx.snowMm !== "number" || !isFinite(wx.snowMm)) {
      return {
        known: false,
        label: "Snow depth unavailable",
        detail:
          "No measured snow depth. Recent snowfall water-equivalent may be missing too — do not invent depth from temperature."
      };
    }
    // Open-Meteo snowfall_sum is water-equivalent mm, not depth.
    return {
      known: true,
      snowfallWaterMm: wx.snowMm,
      depthKnown: false,
      label: "Recent snowfall (water-equivalent), depth unknown",
      detail:
        Math.round(wx.snowMm * 10) / 10 +
        " mm snowfall water-equivalent (3-day sum). Ground depth is not sensed — treat cover as unknown."
    };
  }

  /**
   * Build searchability briefing. Season is attached as a badge only — never mixed
   * into window scores (caller should pass seasonSeparate: true to Today's Search).
   */
  function evaluate(opts) {
    opts = opts || {};
    var Todays = getTodays();
    var snow = snowStatus(opts.weather);

    if (!Todays || typeof Todays.build !== "function") {
      return {
        channel: "searchability",
        status: "unavailable",
        headline: "Search conditions unavailable",
        favorability: "uncertain",
        why: ["Searchability module dependency missing."],
        limitations: [DISCLAIMER],
        snow: snow,
        disclaimer: DISCLAIMER,
        brief: null
      };
    }

    var brief = Todays.build(
      Object.assign({}, opts, {
        seasonSeparate: true,
        excludeSeasonFromWindows: true,
        framing: "searchability"
      })
    );

    var why = [];
    if (brief && brief.timeWindows && brief.timeWindows[0]) {
      why.push(
        "Best search window guess: " +
          brief.timeWindows[0].label +
          " — based on weather/daylight heuristics, not cast biology."
      );
    }
    if (snow.known) why.push(snow.detail);
    else why.push(snow.detail);

    var limitations = [
      DISCLAIMER,
      "Weather is not treated as a same-day antler-cast trigger.",
      "Snow depth is unavailable unless a depth sensor exists (it does not here)."
    ];

    return {
      channel: "searchability",
      status: brief ? brief.status : "unavailable",
      headline: brief ? brief.headline : "Search conditions",
      favorability: brief ? brief.favorability : "uncertain",
      timeWindows: brief ? brief.timeWindows : [],
      areas: brief ? brief.areas : [],
      signals: brief ? brief.signals : [],
      uncertainties: brief ? brief.uncertainties : [],
      why: why,
      limitations: limitations,
      snow: snow,
      disclaimer: DISCLAIMER,
      brief: brief,
      summaryLine: brief ? brief.summaryLine : null
    };
  }

  global.WaypointShedsSearchability = {
    DISCLAIMER: DISCLAIMER,
    snowStatus: snowStatus,
    evaluate: evaluate
  };
})(typeof window !== "undefined" ? window : globalThis);
