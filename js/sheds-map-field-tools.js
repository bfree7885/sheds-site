/**
 * Sheds field map tools — distance math + formatting (no Leaflet dependency).
 * Measure / inspect orchestration lives in sheds-map-app.js.
 */
(function (global) {
  "use strict";

  var EARTH_R_M = 6371008.8;

  function toRad(d) {
    return (d * Math.PI) / 180;
  }

  function toDeg(r) {
    return (r * 180) / Math.PI;
  }

  /** Great-circle distance in meters (haversine). */
  function distanceM(aLat, aLng, bLat, bLng) {
    var φ1 = toRad(aLat);
    var φ2 = toRad(bLat);
    var Δφ = toRad(bLat - aLat);
    var Δλ = toRad(bLng - aLng);
    var s =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return 2 * EARTH_R_M * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  /** Initial bearing from A → B in degrees [0, 360). */
  function bearingDeg(aLat, aLng, bLat, bLng) {
    var φ1 = toRad(aLat);
    var φ2 = toRad(bLat);
    var Δλ = toRad(bLng - aLng);
    var y = Math.sin(Δλ) * Math.cos(φ2);
    var x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function cardinalFromBearing(deg) {
    if (deg == null || !isFinite(deg)) return "";
    var dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    var ix = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
    return dirs[ix];
  }

  /**
   * Field-friendly distance labels.
   * < ~300 yd → feet; < 1 mi → yards; else miles.
   */
  function formatFieldDistance(meters) {
    if (meters == null || !isFinite(meters) || meters < 0) return "—";
    if (meters < 3) return Math.max(1, Math.round(meters * 3.28084)) + " ft";
    if (meters < 274.32) return Math.round(meters * 3.28084) + " ft";
    if (meters < 1609.344) return Math.round(meters * 1.0936133) + " yd";
    var mi = meters / 1609.344;
    return (mi >= 10 ? mi.toFixed(1) : mi.toFixed(2)) + " mi";
  }

  function pathLengthM(points) {
    if (!points || points.length < 2) return 0;
    var total = 0;
    var i;
    for (i = 1; i < points.length; i += 1) {
      total += distanceM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    }
    return total;
  }

  /**
   * Spherical polygon area (m²) via spherical excess. Requires ≥3 points.
   * Not projected — good enough for field parcels under ~a few km².
   */
  function polygonAreaM2(points) {
    if (!points || points.length < 3) return null;
    var n = points.length;
    var total = 0;
    var i;
    for (i = 0; i < n; i += 1) {
      var a = points[i];
      var b = points[(i + 1) % n];
      total += toRad(b.lng - a.lng) * (2 + Math.sin(toRad(a.lat)) + Math.sin(toRad(b.lat)));
    }
    return Math.abs((total * EARTH_R_M * EARTH_R_M) / 2);
  }

  function formatFieldArea(m2) {
    if (m2 == null || !isFinite(m2) || m2 <= 0) return null;
    var acres = m2 / 4046.8564224;
    if (acres < 0.1) return Math.round(m2 * 10.76391) + " ft²";
    if (acres < 20) return acres.toFixed(2) + " ac";
    if (acres < 1000) return acres.toFixed(1) + " ac";
    /* Large field polygons: whole acres — avoid pathological 7-digit .1 noise. */
    return Math.round(acres).toLocaleString("en-US") + " ac";
  }

  global.WaypointShedsFieldTools = {
    distanceM: distanceM,
    bearingDeg: bearingDeg,
    cardinalFromBearing: cardinalFromBearing,
    formatFieldDistance: formatFieldDistance,
    pathLengthM: pathLengthM,
    polygonAreaM2: polygonAreaM2,
    formatFieldArea: formatFieldArea
  };
})(typeof window !== "undefined" ? window : globalThis);
