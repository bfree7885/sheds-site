/**
 * Sheds Phase 4 — UX polish helpers (first-run coach, empty-state copy, trip labels).
 * Presentation only — does not change Timing / Habitat / Searchability models.
 */
(function (global) {
  "use strict";

  var COACH_KEY = "waypoint-sheds-first-run-coach-v1";

  var EMPTY = Object.freeze({
    NO_SEARCH: "Tap the map to choose an area to inspect.",
    NO_GIS: "Landscape guidance isn’t available for this area yet.",
    NO_OBS: "No field observations recorded here yet.",
    NO_WEATHER: "Live conditions unavailable. Your saved area and field records still work.",
    COARSE_GPS: "Your location is approximate. Choose a Search Area manually for detailed landscape guidance.",
    NO_NETWORK: "No network. Live conditions unavailable. Your saved area and field records still work."
  });

  function coachDismissed() {
    try {
      return global.localStorage && global.localStorage.getItem(COACH_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function dismissCoach() {
    try {
      if (global.localStorage) global.localStorage.setItem(COACH_KEY, "1");
    } catch (e) { /* private mode */ }
  }

  function resetCoachForTests() {
    try {
      if (global.localStorage) global.localStorage.removeItem(COACH_KEY);
    } catch (e) { /* */ }
  }

  function shouldShowCoach() {
    return !coachDismissed();
  }

  /**
   * Compact observation summary for active Search Area.
   * @returns {{ summary: string, count: number, sheds: number, recentNote: string|null }}
   */
  function summarizeObservationsForArea(observations, center, radiusM) {
    observations = observations || [];
    var list = observations;
    function coords(o) {
      if (!o) return null;
      if (o.lat != null && o.lng != null) return { lat: o.lat, lng: o.lng };
      if (o.location && o.location.lat != null && o.location.lng != null) {
        return { lat: o.location.lat, lng: o.location.lng };
      }
      return null;
    }
    if (center && radiusM != null && isFinite(radiusM)) {
      list = observations.filter(function (o) {
        var c = coords(o);
        if (!c) return false;
        var dlat = (c.lat - center.lat) * 111320;
        var dlng = (c.lng - center.lng) * 111320 * Math.cos((center.lat * Math.PI) / 180);
        return Math.sqrt(dlat * dlat + dlng * dlng) <= radiusM;
      });
    }
    var sheds = 0;
    var recentNote = null;
    var newest = 0;
    list.forEach(function (o) {
      var t = o.type || o.observationType || "";
      if (/shed/i.test(t)) sheds += 1;
      var ts = Date.parse(o.observedAt || o.createdAt || "") || 0;
      if (ts >= newest && o.note) {
        newest = ts;
        recentNote = String(o.note).trim().slice(0, 120) || null;
      }
    });
    if (!list.length) {
      return { summary: EMPTY.NO_OBS, count: 0, sheds: 0, recentNote: null };
    }
    var parts = [list.length + " observation" + (list.length === 1 ? "" : "s")];
    if (sheds) parts.push(sheds + " shed" + (sheds === 1 ? "" : "s") + " recorded");
    if (recentNote) parts.push("Recent note: “" + recentNote + "”");
    return {
      summary: parts.join(" · "),
      count: list.length,
      sheds: sheds,
      recentNote: recentNote
    };
  }

  function whereLine(searchLocation, areaName, radiusM) {
    if (!searchLocation) return EMPTY.NO_SEARCH;
    var name = areaName || "Search Area";
    var r = radiusM != null ? " · ~" + Math.round(radiusM) + " m" : "";
    return name + r + " — the area you chose to analyze (not YOU).";
  }

  function nextLine(opts) {
    opts = opts || {};
    if (opts.tracking) return "Search active — add notes as you go, then End Search.";
    if (!opts.hasSearch) return "Tap the map to set a Search Area, then open Field Plan or Start Search.";
    if (opts.gisUnavailable) return "Landscape MODEL unavailable here — Start Search still works with your notes.";
    if (opts.weatherUnavailable) return "Live conditions limited — Field Plan and Start Search still work.";
    return "Open Field Plan to review, or Start Search when you’re ready.";
  }

  function landscapeLine(habitat) {
    if (!habitat) return EMPTY.NO_GIS;
    if (habitat.unavailable || (habitat.empty && /unavailable|not available|no gis|no pack/i.test(
      (habitat.label || "") + " " + (habitat.detail || "")
    ))) {
      return EMPTY.NO_GIS;
    }
    if (habitat.empty) {
      return habitat.label || EMPTY.NO_GIS;
    }
    var band = habitat.band ? " · " + habitat.band : "";
    return (habitat.label || "Landscape guidance") + band + " — based on mapped landscape structure (MODEL).";
  }

  function timingPlain(timing) {
    if (!timing) return "Season timing unclear";
    return timing.plainLabel || timing.label || "Season timing unclear";
  }

  function weatherStatusLine(status, offline) {
    if (offline) return EMPTY.NO_NETWORK;
    if (status === "weather_unavailable" || status === "unavailable") return EMPTY.NO_WEATHER;
    if (status === "loading") return "Reading today’s field conditions…";
    return null;
  }

  global.WaypointShedsUxPolish = {
    COACH_KEY: COACH_KEY,
    EMPTY: EMPTY,
    coachDismissed: coachDismissed,
    dismissCoach: dismissCoach,
    resetCoachForTests: resetCoachForTests,
    shouldShowCoach: shouldShowCoach,
    summarizeObservationsForArea: summarizeObservationsForArea,
    whereLine: whereLine,
    nextLine: nextLine,
    landscapeLine: landscapeLine,
    timingPlain: timingPlain,
    weatherStatusLine: weatherStatusLine
  };
})(typeof window !== "undefined" ? window : globalThis);
