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
    var depthKnown = wx.snowDepthKnown === true &&
      typeof wx.snowDepthM === "number" && isFinite(wx.snowDepthM);
    var snowfallKnown = typeof wx.snowMm === "number" && isFinite(wx.snowMm);
    var cover = wx.snowCover || null;

    if (depthKnown) {
      return {
        known: true,
        depthKnown: true,
        depthM: wx.snowDepthM,
        snowfallSumCm: snowfallKnown ? wx.snowMm : null,
        label: cover && cover.label ? cover.label : "Measured snow depth",
        detail: cover && cover.detail
          ? cover.detail
          : "Measured snow depth is used for cover. Snowfall is not treated as depth."
      };
    }

    // Missing snow_depth is not zero snow. Snowfall/SWE is not a substitute.
    return {
      known: false,
      depthKnown: false,
      snowfallSumCm: snowfallKnown ? wx.snowMm : null,
      label: "Snow-depth data is unavailable",
      detail: snowfallKnown
        ? "Snow-depth data is unavailable. Recent snowfall is listed separately and is not treated as ground depth."
        : "Snow-depth data is unavailable. Do not treat missing depth as clear ground."
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
      "Snow depth is used only when Open-Meteo returns a numeric snow_depth. Missing depth is not treated as clear ground."
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
