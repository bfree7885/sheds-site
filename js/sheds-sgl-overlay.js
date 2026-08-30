/**
 * Sheds Phase 2 — PA State Game Lands as MAP / ACCESS CONTEXT only.
 * Never feeds habitat weights. Wording: verify current access regulations.
 */
(function (global) {
  "use strict";

  var CACHE_KEY = "waypoint-sheds-sgl-cache-v1";
  var LABEL = "State Game Lands boundary — verify current access regulations";

  /**
   * PASDA / PGC public State Game Lands MapServer (query layer 0).
   * Context only — not habitat suitability.
   */
  var QUERY_URL =
    "https://mapservices.pasda.psu.edu/server/rest/services/pasda/PAGC_StateGameLands/MapServer/0/query";

  function cacheGet(bboxKey) {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var all = JSON.parse(raw);
      return all && all[bboxKey] ? all[bboxKey] : null;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(bboxKey, geojson) {
    try {
      var all = {};
      try {
        all = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {};
      } catch (e2) {
        all = {};
      }
      all[bboxKey] = { geojson: geojson, cachedAt: new Date().toISOString(), label: LABEL };
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (e) {
      /* quota */
    }
  }

  function bboxKey(bounds) {
    return [
      bounds.west.toFixed(3),
      bounds.south.toFixed(3),
      bounds.east.toFixed(3),
      bounds.north.toFixed(3)
    ].join("|");
  }

  function fetchSgl(bounds, opts) {
    opts = opts || {};
    var key = bboxKey(bounds);
    var cached = cacheGet(key);
    if (cached && cached.geojson && !opts.forceNetwork) {
      return Promise.resolve({
        geojson: cached.geojson,
        fromCache: true,
        label: LABEL,
        channel: "map_access_context",
        habitatWeight: false
      });
    }
    var geometry =
      bounds.west + "," + bounds.south + "," + bounds.east + "," + bounds.north;
    var url =
      QUERY_URL +
      "?where=1%3D1&geometry=" +
      encodeURIComponent(geometry) +
      "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects" +
      "&outFields=SGL_NAME,NAME&returnGeometry=true&outSR=4326&f=geojson";
    return fetch(url, { cache: "force-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("SGL " + r.status);
        return r.json();
      })
      .then(function (geojson) {
        cacheSet(key, geojson);
        return {
          geojson: geojson,
          fromCache: false,
          label: LABEL,
          channel: "map_access_context",
          habitatWeight: false
        };
      })
      .catch(function (err) {
        if (cached && cached.geojson) {
          return {
            geojson: cached.geojson,
            fromCache: true,
            degraded: true,
            label: LABEL,
            channel: "map_access_context",
            habitatWeight: false,
            error: String(err && err.message ? err.message : err)
          };
        }
        return {
          geojson: null,
          unavailable: true,
          label: LABEL,
          channel: "map_access_context",
          habitatWeight: false,
          error: String(err && err.message ? err.message : err)
        };
      });
  }

  /** Explicit: SGL membership must never enter habitatScore. */
  function habitatWeightFromSgl() {
    return 0;
  }

  global.WaypointShedsSglOverlay = {
    LABEL: LABEL,
    QUERY_URL: QUERY_URL,
    fetchSgl: fetchSgl,
    habitatWeightFromSgl: habitatWeightFromSgl,
    CACHE_KEY: CACHE_KEY
  };
})(typeof window !== "undefined" ? window : globalThis);
