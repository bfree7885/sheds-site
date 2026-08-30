/**
 * Sheds Phase 2 — SEARCH LOCATION / SEARCH AREA (distinct from YOU / TARGET / OBSERVATION).
 * Accuracy gate: coarse YOU must not auto-become SEARCH.
 */
(function (global) {
  "use strict";

  /** Product threshold: deliberate "Analyze at YOU" only when accuracy is this good or better. */
  var YOU_ACCURACY_MAX_M = 500;

  var RADIUS = Object.freeze({
    small: 400,
    medium: 600,
    large: 1000
  });

  var DEFAULT_RADIUS_KEY = "medium";

  var PROMPT_COARSE =
    "Your location is approximate. Choose a Search Area manually for detailed landscape guidance.";

  var PROMPT_DEFAULT = "Tap the map to choose an area to inspect.";

  function haversineM(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function radiusMForKey(key) {
    if (key && RADIUS[key] != null) return RADIUS[key];
    return RADIUS[DEFAULT_RADIUS_KEY];
  }

  function canAnalyzeAtYou(accuracyM) {
    return accuracyM != null && isFinite(accuracyM) && accuracyM > 0 && accuracyM <= YOU_ACCURACY_MAX_M;
  }

  function needsSearchPrompt(accuracyM, hasSearch) {
    if (hasSearch) return false;
    if (accuracyM == null || !isFinite(accuracyM)) return true;
    return accuracyM > YOU_ACCURACY_MAX_M;
  }

  function promptText(accuracyM) {
    if (accuracyM != null && isFinite(accuracyM) && accuracyM > YOU_ACCURACY_MAX_M) {
      return PROMPT_COARSE;
    }
    return PROMPT_DEFAULT;
  }

  function createSearchLocation(lat, lng, source) {
    return {
      lat: lat,
      lng: lng,
      source: source || "map-tap",
      kind: "search_location",
      updatedAt: new Date().toISOString()
    };
  }

  function isInsideSearchArea(search, radiusM, lat, lng) {
    if (!search || !isFinite(search.lat) || !isFinite(search.lng)) return false;
    return haversineM(search.lat, search.lng, lat, lng) <= radiusM;
  }

  /** GPS / weather / date updates must never mutate SEARCH LOCATION. */
  function assertIndependent(searchBefore, searchAfter) {
    if (!searchBefore && !searchAfter) return true;
    if (!searchBefore || !searchAfter) return false;
    return (
      searchBefore.lat === searchAfter.lat &&
      searchBefore.lng === searchAfter.lng &&
      searchBefore.updatedAt === searchAfter.updatedAt
    );
  }

  global.WaypointShedsSearchArea = {
    YOU_ACCURACY_MAX_M: YOU_ACCURACY_MAX_M,
    RADIUS: RADIUS,
    DEFAULT_RADIUS_KEY: DEFAULT_RADIUS_KEY,
    PROMPT_COARSE: PROMPT_COARSE,
    PROMPT_DEFAULT: PROMPT_DEFAULT,
    radiusMForKey: radiusMForKey,
    canAnalyzeAtYou: canAnalyzeAtYou,
    needsSearchPrompt: needsSearchPrompt,
    promptText: promptText,
    createSearchLocation: createSearchLocation,
    isInsideSearchArea: isInsideSearchArea,
    assertIndependent: assertIndependent,
    haversineM: haversineM
  };
})(typeof window !== "undefined" ? window : globalThis);
