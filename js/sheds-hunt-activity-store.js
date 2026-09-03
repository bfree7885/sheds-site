/**
 * Sheds V1.7 — in-progress Hunt Activity (local GPS track + field observations).
 *
 * A Hunt Activity is the private record of a V1.6 Hunt Session in progress:
 * device-reported track points and hunter-entered observations.
 *
 * It is not a Hunt Plan, not a route, not navigation, and not a prediction.
 * Coordinates are never invented. Malformed GPS is dropped, not repaired into
 * a fictional path.
 *
 * Schema: waypoint-sheds-hunt-activity-v1
 * One in-progress activity per origin, bound to Hunt Session sessionId.
 * Finish moves a snapshot into waypoint-sheds-hunt-records-v1.
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "waypoint-sheds-hunt-activity-v1";
  var SCHEMA_VERSION = 1;
  var KIND = "hunt-activity";
  var RECORD_KIND = "hunt-record";
  var PRIVACY = "private-local";
  var MAX_TRACK_POINTS = 1800;
  var MAX_OBSERVATIONS = 80;
  var MAX_NOTE = 400;
  var MIN_MOVE_M = 3;
  var JITTER_M = 8;
  var JITTER_MS = 8000;
  var MIN_INTERVAL_MS = 4000;
  var BURST_MOVE_M = 25;
  var JUMP_M = 2000;
  var JUMP_MS = 3000;
  var POOR_ACCURACY_M = 120;
  var EARTH_M = 6371000;

  var OBSERVATION_TYPES = [
    { id: "shed_found", label: "Shed Found" },
    { id: "deer_sign", label: "Deer Sign" },
    { id: "trail_crossing", label: "Trail / Crossing" },
    { id: "bedding", label: "Bedding" },
    { id: "feeding", label: "Feeding Sign" },
    { id: "access_obstacle", label: "Access / Obstacle" },
    { id: "other", label: "Other" }
  ];

  var TYPE_IDS = {};
  OBSERVATION_TYPES.forEach(function (t) { TYPE_IDS[t.id] = t; });

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function finiteCoord(lat, lng) {
    var la = Number(lat);
    var ln = Number(lng);
    if (!isFinite(la) || !isFinite(ln)) return null;
    if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
    return { lat: la, lng: ln };
  }

  function haversineM(a, b) {
    if (!a || !b) return null;
    var locA = finiteCoord(a.lat, a.lng);
    var locB = finiteCoord(b.lat, b.lng);
    if (!locA || !locB) return null;
    var lat1 = locA.lat * Math.PI / 180;
    var lat2 = locB.lat * Math.PI / 180;
    var dLat = (locB.lat - locA.lat) * Math.PI / 180;
    var dLng = (locB.lng - locA.lng) * Math.PI / 180;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_M * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  function optionalAccuracy(v) {
    if (v == null || v === "") return undefined;
    var n = Number(v);
    if (!isFinite(n) || n < 0 || n > 100000) return undefined;
    return n;
  }

  function optionalAltitude(v) {
    if (v == null || v === "") return undefined;
    var n = Number(v);
    if (!isFinite(n) || n < -500 || n > 9000) return undefined;
    return n;
  }

  function optionalTime(v) {
    if (v == null || v === "") return Date.now();
    if (typeof v === "number" && isFinite(v)) return v;
    var parsed = Date.parse(String(v));
    if (isFinite(parsed)) return parsed;
    var n = Number(v);
    return isFinite(n) ? n : Date.now();
  }

  /**
   * Classify a candidate GPS sample. Never invents a replacement coordinate.
   * Filtering removes obvious noise; it does not smooth a cleaner fictional route.
   */
  function classifyTrackPoint(prev, raw) {
    if (!raw || typeof raw !== "object") {
      return { accept: false, reason: "malformed" };
    }
    var loc = finiteCoord(raw.lat, raw.lng);
    if (!loc) {
      var latN = Number(raw.lat);
      var lngN = Number(raw.lng);
      if (!isFinite(latN) || !isFinite(lngN)) return { accept: false, reason: "malformed" };
      return { accept: false, reason: "impossible" };
    }
    var t = optionalTime(raw.t != null ? raw.t : raw.timestamp);
    var point = { lat: loc.lat, lng: loc.lng, t: t };
    var acc = optionalAccuracy(raw.acc != null ? raw.acc : raw.accuracy);
    var alt = optionalAltitude(raw.alt != null ? raw.alt : raw.altitude);
    if (acc != null) point.acc = acc;
    if (alt != null) point.alt = alt;

    if (!prev) return { accept: true, reason: "first", point: point };

    var dt = point.t - (prev.t || 0);
    if (dt < 0) dt = 0;
    var dist = haversineM(prev, point);
    if (dist == null) return { accept: false, reason: "malformed" };

    if (dist < MIN_MOVE_M) return { accept: false, reason: "duplicate", point: point, dist: dist, dt: dt };
    if (dist < JITTER_M && dt < JITTER_MS) {
      return { accept: false, reason: "jitter", point: point, dist: dist, dt: dt };
    }
    if (dt < MIN_INTERVAL_MS && dist < BURST_MOVE_M) {
      return { accept: false, reason: "too_frequent", point: point, dist: dist, dt: dt };
    }
    if (dist > JUMP_M && dt < JUMP_MS) {
      return { accept: false, reason: "jump", point: point, dist: dist, dt: dt };
    }
    return { accept: true, reason: "ok", point: point, dist: dist, dt: dt };
  }

  function shouldAcceptTrackPoint(prevPoints, raw) {
    var prev = null;
    if (Array.isArray(prevPoints) && prevPoints.length) {
      prev = prevPoints[prevPoints.length - 1];
    } else if (prevPoints && typeof prevPoints === "object" && prevPoints.lat != null) {
      prev = prevPoints;
    }
    return classifyTrackPoint(prev, raw);
  }

  function normalizeTrackPoint(raw) {
    var loc = raw && finiteCoord(raw.lat, raw.lng);
    if (!loc) return null;
    var t = optionalTime(raw.t != null ? raw.t : raw.timestamp);
    var point = { lat: loc.lat, lng: loc.lng, t: t };
    var acc = optionalAccuracy(raw.acc != null ? raw.acc : raw.accuracy);
    var alt = optionalAltitude(raw.alt != null ? raw.alt : raw.altitude);
    if (acc != null) point.acc = acc;
    if (alt != null) point.alt = alt;
    return point;
  }

  function normalizeObservation(raw) {
    if (!raw || typeof raw !== "object") return null;
    var type = raw.type != null ? String(raw.type).trim() : "";
    if (!TYPE_IDS[type]) return null;
    var loc = finiteCoord(raw.lat, raw.lng);
    if (!loc && raw.location) loc = finiteCoord(raw.location.lat, raw.location.lng);
    var mapped = !!loc;
    var note = raw.note != null ? String(raw.note).replace(/^\s+|\s+$/g, "").slice(0, MAX_NOTE) : "";
    return {
      id: raw.id && String(raw.id).trim() ? String(raw.id).trim().slice(0, 80) : ("hobs_" + uuid()),
      type: type,
      label: TYPE_IDS[type].label,
      createdAt: raw.createdAt || nowIso(),
      mapped: mapped,
      lat: mapped ? loc.lat : undefined,
      lng: mapped ? loc.lng : undefined,
      note: note,
      huntRecordId: raw.huntRecordId ? String(raw.huntRecordId).slice(0, 80) : undefined,
      sessionId: raw.sessionId ? String(raw.sessionId).slice(0, 80) : undefined,
      privacy: PRIVACY
    };
  }

  function clipIds(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    var seen = {};
    list.forEach(function (id) {
      var s = id != null ? String(id).trim().slice(0, 80) : "";
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    });
    return out.slice(0, 80);
  }

  function trackingStateOf(v) {
    if (v === "tracking" || v === "unavailable" || v === "paused") return v;
    return "unavailable";
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.kind != null && String(raw.kind) !== KIND && String(raw.kind) !== RECORD_KIND) return null;
    var sessionId = raw.sessionId != null ? String(raw.sessionId).trim().slice(0, 80) : "";
    if (!sessionId) return null;
    var points = [];
    var srcPoints = Array.isArray(raw.trackPoints) ? raw.trackPoints : [];
    srcPoints.forEach(function (p) {
      var n = normalizeTrackPoint(p);
      if (n) points.push(n);
    });
    if (points.length > MAX_TRACK_POINTS) {
      points = points.slice(points.length - MAX_TRACK_POINTS);
    }
    var observations = [];
    var srcObs = Array.isArray(raw.observations) ? raw.observations : [];
    srcObs.forEach(function (o) {
      var n = normalizeObservation(o);
      if (n) observations.push(n);
    });
    if (observations.length > MAX_OBSERVATIONS) {
      observations = observations.slice(0, MAX_OBSERVATIONS);
    }
    var name = raw.huntPlanNameSnapshot != null
      ? String(raw.huntPlanNameSnapshot).trim().slice(0, 80)
      : "";
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: KIND,
      huntRecordId: raw.huntRecordId && String(raw.huntRecordId).trim()
        ? String(raw.huntRecordId).trim().slice(0, 80)
        : ("hrec_" + uuid()),
      sessionId: sessionId,
      huntPlanId: raw.huntPlanId != null && String(raw.huntPlanId).trim()
        ? String(raw.huntPlanId).trim().slice(0, 80)
        : null,
      huntPlanNameSnapshot: name || "Hunt Plan",
      startedAt: raw.startedAt || nowIso(),
      trackingState: trackingStateOf(raw.trackingState),
      trackPoints: points,
      observations: observations,
      scoutSpotIdsSnapshot: clipIds(raw.scoutSpotIdsSnapshot || raw.scoutSpotIds),
      quotaWarning: raw.quotaWarning ? String(raw.quotaWarning).slice(0, 240) : null,
      privacy: PRIVACY
    };
  }

  function loadRaw() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && typeof data === "object" && data.activity && typeof data.activity === "object") {
        return normalize(data.activity);
      }
      return normalize(data);
    } catch (e) {
      return null;
    }
  }

  function persist(activity) {
    try {
      if (!activity) {
        localStorage.removeItem(STORAGE_KEY);
        return { ok: true };
      }
      var next = normalize(activity);
      if (!next) return { ok: false, error: "Could not save Hunt Activity." };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        activity: next
      }));
      return { ok: true, activity: next };
    } catch (e) {
      return {
        ok: false,
        error: "Could not save Hunt Track locally. Storage may be full or unavailable. The hunt was not discarded."
      };
    }
  }

  function get() {
    return loadRaw();
  }

  function clear() {
    return persist(null);
  }

  function setTrackingState(state) {
    var activity = loadRaw();
    if (!activity) return { ok: false, error: "No Hunt is in progress." };
    activity.trackingState = trackingStateOf(state);
    var saved = persist(activity);
    if (!saved.ok) return saved;
    return { ok: true, activity: get() };
  }

  function start(opts) {
    opts = opts || {};
    var sessionId = opts.sessionId != null ? String(opts.sessionId).trim() : "";
    if (!sessionId) return { ok: false, error: "Hunt Session required." };
    var existing = loadRaw();
    if (existing && existing.sessionId === sessionId) {
      if (opts.huntPlanName && !existing.huntPlanNameSnapshot) {
        existing.huntPlanNameSnapshot = String(opts.huntPlanName).trim().slice(0, 80);
      }
      if (opts.scoutSpotIds && (!existing.scoutSpotIdsSnapshot || !existing.scoutSpotIdsSnapshot.length)) {
        existing.scoutSpotIdsSnapshot = clipIds(opts.scoutSpotIds);
      }
      var restored = persist(existing);
      if (!restored.ok) return restored;
      return { ok: true, activity: get(), restored: true };
    }
    var orphan = null;
    if (existing && existing.sessionId !== sessionId) {
      orphan = existing;
    }
    var activity = normalize({
      huntRecordId: "hrec_" + uuid(),
      sessionId: sessionId,
      huntPlanId: opts.huntPlanId || null,
      huntPlanNameSnapshot: opts.huntPlanName || "Hunt Plan",
      startedAt: opts.startedAt || nowIso(),
      trackingState: opts.trackingState || "unavailable",
      trackPoints: [],
      observations: [],
      scoutSpotIdsSnapshot: opts.scoutSpotIds || []
    });
    var saved = persist(activity);
    if (!saved.ok) return saved;
    return { ok: true, activity: get(), restored: false, orphan: orphan };
  }

  function lastPoint(activity) {
    if (!activity || !activity.trackPoints || !activity.trackPoints.length) return null;
    return activity.trackPoints[activity.trackPoints.length - 1];
  }

  function addTrackPoint(raw, opts) {
    opts = opts || {};
    var activity = loadRaw();
    if (!activity) return { ok: false, accepted: false, reason: "no_activity", error: "No Hunt is in progress." };
    var verdict = classifyTrackPoint(lastPoint(activity), raw);
    if (!verdict.accept) {
      return {
        ok: true,
        accepted: false,
        reason: verdict.reason,
        activity: activity,
        dist: verdict.dist,
        dt: verdict.dt
      };
    }
    activity.trackPoints.push(verdict.point);
    var trimmed = false;
    if (activity.trackPoints.length > MAX_TRACK_POINTS) {
      activity.trackPoints = activity.trackPoints.slice(activity.trackPoints.length - MAX_TRACK_POINTS);
      trimmed = true;
      activity.quotaWarning = "Oldest track points were dropped to stay within the local cap.";
    }
    if (opts.trackingState) activity.trackingState = trackingStateOf(opts.trackingState);
    else if (activity.trackingState !== "tracking") activity.trackingState = "tracking";
    var saved = persist(activity);
    if (!saved.ok) {
      return {
        ok: false,
        accepted: false,
        reason: "persist_failed",
        error: saved.error,
        point: verdict.point
      };
    }
    return {
      ok: true,
      accepted: true,
      reason: verdict.reason,
      activity: get(),
      trimmed: trimmed,
      dist: verdict.dist,
      dt: verdict.dt
    };
  }

  function addObservation(opts) {
    opts = opts || {};
    var activity = loadRaw();
    if (!activity) return { ok: false, error: "No Hunt is in progress." };
    if (activity.observations.length >= MAX_OBSERVATIONS) {
      return { ok: false, error: "This hunt already has the maximum number of observations." };
    }
    var type = opts.type != null ? String(opts.type).trim() : "";
    if (!TYPE_IDS[type]) return { ok: false, error: "Choose an observation type." };
    var loc = finiteCoord(opts.lat, opts.lng);
    if (!loc && opts.location) loc = finiteCoord(opts.location.lat, opts.location.lng);
    var obs = normalizeObservation({
      id: "hobs_" + uuid(),
      type: type,
      createdAt: opts.createdAt || nowIso(),
      lat: loc ? loc.lat : undefined,
      lng: loc ? loc.lng : undefined,
      note: opts.note,
      huntRecordId: activity.huntRecordId,
      sessionId: activity.sessionId
    });
    if (!obs) return { ok: false, error: "Could not save that observation." };
    activity.observations.push(obs);
    var saved = persist(activity);
    if (!saved.ok) return saved;
    return { ok: true, observation: obs, activity: get(), mapped: obs.mapped };
  }

  function durationMs(startedAt, nowMs) {
    var t0 = Date.parse(startedAt);
    if (!isFinite(t0)) return null;
    var now = nowMs != null ? Number(nowMs) : Date.now();
    if (!isFinite(now)) now = Date.now();
    return Math.max(0, now - t0);
  }

  function formatDuration(ms) {
    if (ms == null || !isFinite(ms) || ms < 0) return "—";
    var sec = Math.floor(ms / 1000);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    function pad(n) { return String(n).padStart(2, "0"); }
    if (h > 0) return pad(h) + ":" + pad(m);
    return pad(m) + ":" + pad(s);
  }

  function trackDistance(points) {
    var list = Array.isArray(points) ? points : [];
    if (list.length < 2) {
      return {
        available: false,
        meters: null,
        legs: 0,
        skippedPoorAccuracy: 0,
        reason: list.length ? "need_more_points" : "no_track"
      };
    }
    var sum = 0;
    var legs = 0;
    var skipped = 0;
    var i;
    for (i = 1; i < list.length; i++) {
      var a = list[i - 1];
      var b = list[i];
      var poorA = a.acc != null && a.acc > POOR_ACCURACY_M;
      var poorB = b.acc != null && b.acc > POOR_ACCURACY_M;
      if (poorA || poorB) {
        skipped += 1;
        continue;
      }
      var d = haversineM(a, b);
      if (d == null || !isFinite(d)) continue;
      sum += d;
      legs += 1;
    }
    if (!legs) {
      return {
        available: false,
        meters: null,
        legs: 0,
        skippedPoorAccuracy: skipped,
        reason: skipped ? "poor_accuracy" : "no_usable_legs"
      };
    }
    return {
      available: true,
      meters: sum,
      legs: legs,
      skippedPoorAccuracy: skipped,
      reason: null
    };
  }

  function formatDistance(dist) {
    if (!dist || !dist.available || dist.meters == null || !isFinite(dist.meters)) {
      return "Unavailable";
    }
    var m = dist.meters;
    if (m < 1000) return Math.round(m) + " m";
    var km = m / 1000;
    return (km >= 10 ? km.toFixed(1) : km.toFixed(2)) + " km";
  }

  function summaryFrom(activity) {
    var obs = (activity && activity.observations) || [];
    var mapped = 0;
    var sheds = 0;
    obs.forEach(function (o) {
      if (o && o.mapped) mapped += 1;
      if (o && o.type === "shed_found") sheds += 1;
    });
    var dist = trackDistance(activity && activity.trackPoints);
    return {
      observationCount: obs.length,
      shedFoundCount: sheds,
      mappedObservationCount: mapped,
      unmappedObservationCount: obs.length - mapped,
      trackPointCount: activity && activity.trackPoints ? activity.trackPoints.length : 0,
      trackDistanceM: dist.available ? dist.meters : null,
      trackDistanceAvailable: !!dist.available
    };
  }

  function toRecord(opts) {
    opts = opts || {};
    var activity = opts.activity || loadRaw();
    if (!activity) return null;
    var finishedAt = opts.finishedAt || nowIso();
    var dist = trackDistance(activity.trackPoints);
    var sum = summaryFrom(activity);
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: RECORD_KIND,
      huntRecordId: activity.huntRecordId,
      huntPlanId: activity.huntPlanId,
      huntPlanNameSnapshot: activity.huntPlanNameSnapshot,
      startedAt: activity.startedAt,
      finishedAt: finishedAt,
      trackPoints: activity.trackPoints.slice(),
      trackDistanceM: dist.available ? dist.meters : null,
      trackDistanceAvailable: !!dist.available,
      trackDistanceReason: dist.reason || null,
      observations: activity.observations.slice(),
      scoutSpotIds: activity.scoutSpotIdsSnapshot.slice(),
      summary: sum,
      trackingStateAtFinish: activity.trackingState,
      interrupted: !!opts.interrupted,
      interruptReason: opts.interruptReason || null,
      quotaWarning: activity.quotaWarning,
      privacy: PRIVACY
    };
  }

  function observationLabel(type) {
    return TYPE_IDS[type] ? TYPE_IDS[type].label : "Observation";
  }

  global.WaypointShedsHuntActivity = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    KIND: KIND,
    RECORD_KIND: RECORD_KIND,
    PRIVACY: PRIVACY,
    MAX_TRACK_POINTS: MAX_TRACK_POINTS,
    MAX_OBSERVATIONS: MAX_OBSERVATIONS,
    MIN_MOVE_M: MIN_MOVE_M,
    JITTER_M: JITTER_M,
    JITTER_MS: JITTER_MS,
    MIN_INTERVAL_MS: MIN_INTERVAL_MS,
    BURST_MOVE_M: BURST_MOVE_M,
    JUMP_M: JUMP_M,
    JUMP_MS: JUMP_MS,
    POOR_ACCURACY_M: POOR_ACCURACY_M,
    OBSERVATION_TYPES: OBSERVATION_TYPES,
    finiteCoord: finiteCoord,
    haversineM: haversineM,
    classifyTrackPoint: classifyTrackPoint,
    shouldAcceptTrackPoint: shouldAcceptTrackPoint,
    normalize: normalize,
    normalizeObservation: normalizeObservation,
    get: get,
    persist: persist,
    clear: clear,
    start: start,
    setTrackingState: setTrackingState,
    addTrackPoint: addTrackPoint,
    addObservation: addObservation,
    durationMs: durationMs,
    formatDuration: formatDuration,
    trackDistance: trackDistance,
    formatDistance: formatDistance,
    summaryFrom: summaryFrom,
    toRecord: toRecord,
    observationLabel: observationLabel
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
