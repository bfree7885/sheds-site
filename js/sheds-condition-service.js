/**
 * Sheds V1.9 — Condition Snapshot service.
 *
 * Future V2.0 should call:
 *   WaypointShedsConditionService.getConditionSnapshot({ lat, lng, time })
 *
 * Layers:
 *   1. acquisition  — Open-Meteo forecast via existing WaypointShedsWeather
 *   2. normalization — parseForecast already in sheds-weather.js
 *   3. derived facts — freeze/thaw + snow-cover class (not search priority)
 *   4. future search-priority interpretation — NOT implemented
 *
 * Privacy: the provider receives only latitude and longitude (4 decimal
 * places) plus the existing forecast query fields. No Hunt Record ID, Scout
 * Spot, Hunt Plan, notes, Shed Found, track, or identity.
 *
 * Hunt Field must work if this fails. Callers must not block Start/Finish.
 */
(function (global) {
  "use strict";

  var TIMEOUT_MS = 8000;
  var DEDUPE_MS = 10 * 60 * 1000;
  var inflight = {};
  var lastOk = {};

  function Snap() {
    return global.WaypointShedsConditionSnapshot;
  }

  function Weather() {
    return global.WaypointShedsWeather;
  }

  function requestKey(lat, lng) {
    return Number(lat).toFixed(4) + "," + Number(lng).toFixed(4);
  }

  function isOffline() {
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    } catch (e) { /* */ }
    return false;
  }

  function cloneCached(snap, opts) {
    opts = opts || {};
    var Model = Snap();
    if (!Model || !snap) return snap;
    var copy;
    try {
      copy = JSON.parse(JSON.stringify(snap));
    } catch (e) {
      copy = snap;
    }
    copy.id = undefined;
    copy.createdAt = new Date().toISOString();
    if (opts.validAt) copy.validAt = opts.validAt instanceof Date ? opts.validAt.toISOString() : opts.validAt;
    if (opts.captureContext) copy.captureContext = opts.captureContext;
    if (opts.terrain) copy.terrain = opts.terrain;
    return Model.normalize(copy);
  }

  function requestPayload(lat, lng) {
    return {
      latitude: Number(Number(lat).toFixed(4)),
      longitude: Number(Number(lng).toFixed(4))
    };
  }

  function forecastUrl(lat, lng) {
    var Wx = Weather();
    if (Wx && typeof Wx.forecastUrl === "function") return Wx.forecastUrl(lat, lng);
    return "https://api.open-meteo.com/v1/forecast?latitude=" + Number(lat).toFixed(4) +
      "&longitude=" + Number(lng).toFixed(4);
  }

  function withTimeout(promise, ms) {
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        var err = new Error("timeout");
        err.name = "TimeoutError";
        reject(err);
      }, ms);
    });
    return Promise.race([promise, timeout]).then(function (value) {
      clearTimeout(timer);
      return value;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function fetchWeather(lat, lng, time, timeoutMs) {
    var Wx = Weather();
    if (!Wx || typeof Wx.fetchForecast !== "function") {
      return Promise.reject(new Error("weather-module"));
    }
    var ms = timeoutMs != null ? timeoutMs : TIMEOUT_MS;
    return withTimeout(Wx.fetchForecast(lat, lng, time), ms);
  }

  /**
   * @param {{
   *   lat?: number,
   *   lng?: number,
   *   time?: Date|string,
   *   captureContext?: string,
   *   weatherPackage?: object,
   *   terrain?: object,
   *   timeoutMs?: number,
   *   skipCache?: boolean
   * }} opts
   * @returns {Promise<object>} always a Condition Snapshot (never rejects)
   */
  function getConditionSnapshot(opts) {
    opts = opts || {};
    var Model = Snap();
    if (!Model) {
      return Promise.resolve({
        kind: "condition-snapshot",
        acquisition: { status: "unavailable", reason: "Condition Snapshot module missing." }
      });
    }
    var loc = Model.finiteCoord(opts.lat, opts.lng);
    var validAt = opts.time || new Date();
    var ctx = opts.captureContext || "on-demand";

    if (!loc) {
      return Promise.resolve(Model.unavailable({
        status: opts.lat != null || opts.lng != null ? "invalid-coordinate" : "no-location",
        reason: opts.lat != null || opts.lng != null
          ? "Coordinates were invalid and were not repaired."
          : "No valid coordinates — conditions were not invented.",
        captureContext: ctx,
        validAt: validAt,
        terrain: opts.terrain
      }));
    }

    if (opts.weatherPackage) {
      return Promise.resolve(Model.fromWeatherPackage({
        lat: loc.lat,
        lng: loc.lng,
        validAt: validAt,
        captureContext: ctx,
        weather: opts.weatherPackage,
        terrain: opts.terrain
      }));
    }

    var key = requestKey(loc.lat, loc.lng);
    var nowMs = Date.now();
    if (!opts.skipCache && lastOk[key] && (nowMs - lastOk[key].at) < DEDUPE_MS) {
      return Promise.resolve(cloneCached(lastOk[key].snapshot, {
        captureContext: ctx,
        validAt: validAt,
        terrain: opts.terrain
      }));
    }
    if (!opts.skipCache && inflight[key]) return inflight[key];

    if (isOffline()) {
      return Promise.resolve(Model.unavailable({
        lat: loc.lat,
        lng: loc.lng,
        status: "offline",
        reason: "Device is offline. Hunt can continue without weather.",
        captureContext: ctx,
        validAt: validAt,
        terrain: opts.terrain
      }));
    }

    var pending = fetchWeather(loc.lat, loc.lng, validAt, opts.timeoutMs).then(function (pkg) {
      if (!pkg || typeof pkg !== "object") {
        return Model.unavailable({
          lat: loc.lat,
          lng: loc.lng,
          status: "malformed",
          reason: "Weather response was empty.",
          captureContext: ctx,
          validAt: validAt,
          terrain: opts.terrain
        });
      }
      var snap = Model.fromWeatherPackage({
        lat: loc.lat,
        lng: loc.lng,
        validAt: validAt,
        captureContext: ctx,
        weather: pkg,
        terrain: opts.terrain,
        status: pkg.ready === false ? "unavailable" : "ok",
        reason: pkg.ready === false ? (pkg.reason || "Weather unavailable.") : null
      });
      if (snap && snap.acquisition && snap.acquisition.status === "ok") {
        lastOk[key] = { at: Date.now(), snapshot: snap };
      }
      return snap;
    }).catch(function (err) {
      var status = "unavailable";
      var reason = "Weather request failed. Hunt can continue.";
      if (err && (err.name === "TimeoutError" || /timeout/i.test(String(err.message || "")))) {
        status = "timeout";
        reason = "Weather request timed out. Hunt can continue.";
      } else if (err && /malformed|JSON/i.test(String(err.message || ""))) {
        status = "malformed";
        reason = "Weather response was malformed. Hunt can continue.";
      }
      return Model.unavailable({
        lat: loc.lat,
        lng: loc.lng,
        status: status,
        reason: reason,
        captureContext: ctx,
        validAt: validAt,
        terrain: opts.terrain
      });
    }).then(function (snap) {
      delete inflight[key];
      return snap;
    });

    inflight[key] = pending;
    return pending;
  }

  function _resetCache() {
    inflight = {};
    lastOk = {};
  }

  global.WaypointShedsConditionService = {
    TIMEOUT_MS: TIMEOUT_MS,
    DEDUPE_MS: DEDUPE_MS,
    getConditionSnapshot: getConditionSnapshot,
    requestPayload: requestPayload,
    forecastUrl: forecastUrl,
    requestKey: requestKey,
    _resetCache: _resetCache
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
