/**
 * Sheds V1.7/V1.8 — durable finished Hunt Records (private / local).
 *
 * A Hunt Record is a finished Hunt Activity: device-reported track, duration
 * timestamps, observations, and a Hunt Plan name snapshot. V1.8 Hunt History
 * reads this store. It is not a route, not a prediction, not a heat map, and
 * not uploaded.
 *
 * Schema: waypoint-sheds-hunt-records-v1 (unchanged key; no heat scores)
 *
 * Persistence: localStorage remains the V1.9 store. Caps keep GPS tracks under
 * a typical ~5 MB origin quota. IndexedDB is documented technical debt — do
 * not migrate until photos, offline tiles, multi-season history, or quota
 * failures make localStorage unsafe. Quota failure must not silently discard
 * the hunt being saved: drop older finished records first, then refuse the
 * write if even this hunt cannot fit. Deleting a Hunt Record never deletes
 * Scout Spots or Hunt Plans.
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "waypoint-sheds-hunt-records-v1";
  var SCHEMA_VERSION = 1;
  var KIND = "hunt-record";
  var PRIVACY = "private-local";
  var MAX_RECORDS = 24;
  var MAX_TRACK_POINTS = 1800;
  var MAX_OBSERVATIONS = 80;
  var MAX_NOTE = 400;

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function finiteCoord(lat, lng) {
    var la = Number(lat);
    var ln = Number(lng);
    if (!isFinite(la) || !isFinite(ln)) return null;
    if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
    return { lat: la, lng: ln };
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

  function normalizeTrackPoint(raw) {
    var loc = raw && finiteCoord(raw.lat, raw.lng);
    if (!loc) return null;
    var t = raw.t;
    if (t == null) t = raw.timestamp;
    var tn = typeof t === "number" ? t : Date.parse(String(t));
    if (!isFinite(tn)) tn = 0;
    var point = { lat: loc.lat, lng: loc.lng, t: tn };
    var acc = optionalAccuracy(raw.acc != null ? raw.acc : raw.accuracy);
    var alt = optionalAltitude(raw.alt != null ? raw.alt : raw.altitude);
    if (acc != null) point.acc = acc;
    if (alt != null) point.alt = alt;
    return point;
  }

  function typeOk(type) {
    return type === "shed_found" || type === "deer_sign" || type === "trail_crossing" ||
      type === "bedding" || type === "feeding" || type === "access_obstacle" || type === "other";
  }

  function normalizeObservation(raw) {
    if (!raw || typeof raw !== "object") return null;
    var type = raw.type != null ? String(raw.type).trim() : "";
    if (!typeOk(type)) return null;
    var loc = finiteCoord(raw.lat, raw.lng);
    if (!loc && raw.location) loc = finiteCoord(raw.location.lat, raw.location.lng);
    var labels = {
      shed_found: "Shed Found",
      deer_sign: "Deer Sign",
      trail_crossing: "Trail / Crossing",
      bedding: "Bedding",
      feeding: "Feeding Sign",
      access_obstacle: "Access / Obstacle",
      other: "Other"
    };
    return {
      id: raw.id && String(raw.id).trim() ? String(raw.id).trim().slice(0, 80) : ("hobs_" + uuid()),
      type: type,
      label: raw.label && String(raw.label).trim() ? String(raw.label).trim().slice(0, 40) : labels[type],
      createdAt: raw.createdAt || null,
      mapped: !!loc,
      lat: loc ? loc.lat : undefined,
      lng: loc ? loc.lng : undefined,
      note: raw.note != null ? String(raw.note).replace(/^\s+|\s+$/g, "").slice(0, MAX_NOTE) : "",
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

  function normalizeRecord(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.kind != null && String(raw.kind) !== KIND) return null;
    var huntRecordId = raw.huntRecordId != null ? String(raw.huntRecordId).trim().slice(0, 80) : "";
    if (!huntRecordId && raw.id) huntRecordId = String(raw.id).trim().slice(0, 80);
    if (!huntRecordId) return null;
    var points = [];
    (Array.isArray(raw.trackPoints) ? raw.trackPoints : []).forEach(function (p) {
      var n = normalizeTrackPoint(p);
      if (n) points.push(n);
    });
    if (points.length > MAX_TRACK_POINTS) points = points.slice(points.length - MAX_TRACK_POINTS);
    var observations = [];
    (Array.isArray(raw.observations) ? raw.observations : []).forEach(function (o) {
      var n = normalizeObservation(o);
      if (n) {
        n.huntRecordId = n.huntRecordId || huntRecordId;
        observations.push(n);
      }
    });
    if (observations.length > MAX_OBSERVATIONS) observations = observations.slice(0, MAX_OBSERVATIONS);
    var name = raw.huntPlanNameSnapshot != null
      ? String(raw.huntPlanNameSnapshot).trim().slice(0, 80)
      : "";
    var distM = raw.trackDistanceM;
    if (distM != null) {
      distM = Number(distM);
      if (!isFinite(distM) || distM < 0) distM = null;
    } else distM = null;
    var available = raw.trackDistanceAvailable;
    if (available == null) available = distM != null;
    var sum = raw.summary && typeof raw.summary === "object" ? raw.summary : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: KIND,
      huntRecordId: huntRecordId,
      huntPlanId: raw.huntPlanId != null && String(raw.huntPlanId).trim()
        ? String(raw.huntPlanId).trim().slice(0, 80)
        : null,
      huntPlanNameSnapshot: name || "Hunt Plan",
      startedAt: raw.startedAt || null,
      finishedAt: raw.finishedAt || null,
      trackPoints: points,
      trackDistanceM: distM,
      trackDistanceAvailable: !!available && distM != null,
      trackDistanceReason: raw.trackDistanceReason || (distM != null ? null : "no_track"),
      observations: observations,
      scoutSpotIds: clipIds(raw.scoutSpotIds || raw.scoutSpotIdsSnapshot),
      summary: {
        observationCount: Number(sum.observationCount) || observations.length,
        shedFoundCount: Number(sum.shedFoundCount) || observations.filter(function (o) { return o.type === "shed_found"; }).length,
        mappedObservationCount: Number(sum.mappedObservationCount) || observations.filter(function (o) { return o.mapped; }).length,
        unmappedObservationCount: Number(sum.unmappedObservationCount) || observations.filter(function (o) { return !o.mapped; }).length,
        trackPointCount: Number(sum.trackPointCount) || points.length,
        trackDistanceM: distM,
        trackDistanceAvailable: !!available && distM != null
      },
      trackingStateAtFinish: raw.trackingStateAtFinish || null,
      interrupted: !!raw.interrupted,
      interruptReason: raw.interruptReason || null,
      quotaWarning: raw.quotaWarning ? String(raw.quotaWarning).slice(0, 240) : null,
      conditionSnapshot: normalizeConditionSnapshot(raw.conditionSnapshot),
      privacy: PRIVACY
    };
  }

  function normalizeConditionSnapshot(raw) {
    if (raw == null) return undefined;
    if (typeof raw !== "object") return undefined;
    var Snap = global.WaypointShedsConditionSnapshot;
    if (Snap && typeof Snap.normalize === "function") {
      var n = Snap.normalize(raw);
      return n || undefined;
    }
    if (raw.kind && String(raw.kind) !== "condition-snapshot") return undefined;
    return raw;
  }

  function loadBundle() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { schemaVersion: SCHEMA_VERSION, huntRecords: [] };
      var data = JSON.parse(raw);
      var list = [];
      if (data && Array.isArray(data.huntRecords)) list = data.huntRecords;
      else if (Array.isArray(data)) list = data;
      var records = [];
      list.forEach(function (item) {
        var n = normalizeRecord(item);
        if (n) records.push(n);
      });
      return { schemaVersion: SCHEMA_VERSION, huntRecords: records };
    } catch (e) {
      return { schemaVersion: SCHEMA_VERSION, huntRecords: [], malformed: true };
    }
  }

  function isQuotaError(err) {
    if (!err) return false;
    var name = String(err.name || "");
    var code = err.code;
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
    if (code === 22 || code === 1014) return true;
    return /quota/i.test(String(err.message || ""));
  }

  function sortOldestFirst(records) {
    return records.slice().sort(function (a, b) {
      return String(a.finishedAt || a.startedAt || "") < String(b.finishedAt || b.startedAt || "") ? -1 : 1;
    });
  }

  function dropOldestExcept(records, keepId) {
    if (!records.length) return records;
    var sorted = sortOldestFirst(records);
    var dropIx = 0;
    if (keepId && sorted[0] && sorted[0].huntRecordId === keepId && sorted.length > 1) dropIx = 1;
    if (keepId && sorted.length === 1 && sorted[0].huntRecordId === keepId) return records;
    var dropId = sorted[dropIx] && sorted[dropIx].huntRecordId;
    if (!dropId) return records;
    return records.filter(function (r) { return r.huntRecordId !== dropId; });
  }

  function writeBundle(records, extra) {
    extra = extra || {};
    var keepId = extra.keepId || null;
    var droppedOldest = extra.droppedOldest || 0;
    var warning = extra.warning || null;
    var working = records.slice();

    while (true) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          huntRecords: working
        }));
        return { ok: true, droppedOldest: droppedOldest, warning: warning };
      } catch (e) {
        if (!isQuotaError(e) || working.length <= 1) {
          return {
            ok: false,
            error: "Could not save the Hunt Record locally. Storage may be full or unavailable. The hunt was not discarded.",
            droppedOldest: droppedOldest
          };
        }
        var next = dropOldestExcept(working, keepId);
        if (next.length >= working.length) {
          return {
            ok: false,
            error: "Could not save the Hunt Record locally. Storage may be full or unavailable. The hunt was not discarded.",
            droppedOldest: droppedOldest
          };
        }
        working = next;
        droppedOldest += 1;
        warning = "Oldest finished Hunt Record was removed to make room. This hunt was saved.";
      }
    }
  }

  function list() {
    return loadBundle().huntRecords.slice();
  }

  function getById(id) {
    var sid = id != null ? String(id).trim() : "";
    if (!sid) return null;
    var records = list();
    var i;
    for (i = 0; i < records.length; i++) {
      if (records[i].huntRecordId === sid) return records[i];
    }
    return null;
  }

  function persistRecord(raw) {
    var rec = normalizeRecord(raw);
    if (!rec) return { ok: false, error: "Could not save that Hunt Record." };
    var bundle = loadBundle();
    var records = bundle.huntRecords;
    var idx = -1;
    var i;
    for (i = 0; i < records.length; i++) {
      if (records[i].huntRecordId === rec.huntRecordId) {
        idx = i;
        break;
      }
    }
    var replaced = idx >= 0;
    if (replaced) records[idx] = rec;
    else records.push(rec);

    var droppedOldest = 0;
    var warning = null;
    while (records.length > MAX_RECORDS) {
      var trimmed = dropOldestExcept(records, rec.huntRecordId);
      if (trimmed.length >= records.length) break;
      records = trimmed;
      droppedOldest += 1;
      warning = "Oldest finished Hunt Record was removed to make room. This hunt was saved.";
    }

    var written = writeBundle(records, {
      droppedOldest: droppedOldest,
      warning: warning,
      keepId: rec.huntRecordId
    });
    if (!written.ok) return written;
    return {
      ok: true,
      record: rec,
      replaced: replaced,
      droppedOldest: written.droppedOldest || 0,
      warning: written.warning || null
    };
  }

  function importList(items) {
    var added = 0;
    var replaced = 0;
    var skipped = 0;
    if (!Array.isArray(items)) {
      return { ok: true, added: 0, replaced: 0, skipped: 0 };
    }
    items.forEach(function (item) {
      var rec = normalizeRecord(item);
      if (!rec) {
        skipped += 1;
        return;
      }
      var existing = getById(rec.huntRecordId);
      var result = persistRecord(rec);
      if (!result.ok) {
        skipped += 1;
        return;
      }
      if (existing) replaced += 1;
      else added += 1;
    });
    return { ok: true, added: added, replaced: replaced, skipped: skipped };
  }

  function exportJson() {
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: "hunt-records",
      privacy: PRIVACY,
      huntRecords: list()
    };
  }

  function sortKey(rec) {
    var raw = rec && (rec.finishedAt || rec.startedAt);
    var t = raw ? Date.parse(String(raw)) : NaN;
    return isFinite(t) ? t : 0;
  }

  function listNewestFirst() {
    return list().slice().sort(function (a, b) {
      return sortKey(b) - sortKey(a);
    });
  }

  function listShedFounds() {
    var out = [];
    listNewestFirst().forEach(function (rec) {
      (rec.observations || []).forEach(function (o) {
        if (!o || o.type !== "shed_found") return;
        var created = o.createdAt ? Date.parse(String(o.createdAt)) : NaN;
        out.push({
          huntRecordId: rec.huntRecordId,
          huntPlanNameSnapshot: rec.huntPlanNameSnapshot || "Hunt Plan",
          observationId: o.id,
          createdAt: o.createdAt || null,
          mapped: !!o.mapped,
          lat: o.mapped ? o.lat : undefined,
          lng: o.mapped ? o.lng : undefined,
          note: o.note || "",
          huntStartedAt: rec.startedAt || null,
          huntFinishedAt: rec.finishedAt || null,
          sortKey: isFinite(created) ? created : sortKey(rec)
        });
      });
    });
    out.sort(function (a, b) { return b.sortKey - a.sortKey; });
    return out;
  }

  function removeRecord(id) {
    var sid = id != null ? String(id).trim() : "";
    if (!sid) return { ok: false, error: "Hunt Record not found." };
    var bundle = loadBundle();
    var records = bundle.huntRecords;
    var kept = [];
    var found = false;
    records.forEach(function (r) {
      if (r.huntRecordId === sid) found = true;
      else kept.push(r);
    });
    if (!found) return { ok: false, error: "Hunt Record not found." };
    var written = writeBundle(kept);
    if (!written.ok) return written;
    return { ok: true, removedId: sid };
  }

  function durationMs(rec) {
    if (!rec || !rec.startedAt || !rec.finishedAt) return null;
    var a = Date.parse(String(rec.startedAt));
    var b = Date.parse(String(rec.finishedAt));
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.max(0, b - a);
  }

  function formatDuration(ms) {
    if (ms == null || !isFinite(ms) || ms < 0) return "Unavailable";
    var sec = Math.floor(ms / 1000);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    function pad(n) { return String(n).padStart(2, "0"); }
    if (h > 0) return pad(h) + ":" + pad(m);
    return pad(m) + ":" + pad(sec % 60);
  }

  function formatDistanceM(meters, available) {
    if (!available || meters == null || !isFinite(meters) || meters < 0) return "Unavailable";
    if (meters < 1000) return Math.round(meters) + " m";
    var km = meters / 1000;
    return (km >= 10 ? km.toFixed(1) : km.toFixed(2)) + " km";
  }

  function formatDate(iso) {
    if (!iso) return "Date unavailable";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "Date unavailable";
    try {
      return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    } catch (e) {
      return String(iso).slice(0, 10);
    }
  }

  function formatTime(iso) {
    if (!iso) return "Unavailable";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "Unavailable";
    try {
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return String(iso).slice(11, 16) || "Unavailable";
    }
  }

  global.WaypointShedsHuntRecords = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    KIND: KIND,
    PRIVACY: PRIVACY,
    MAX_RECORDS: MAX_RECORDS,
    MAX_TRACK_POINTS: MAX_TRACK_POINTS,
    normalize: normalizeRecord,
    list: list,
    listNewestFirst: listNewestFirst,
    listShedFounds: listShedFounds,
    getById: getById,
    persist: persistRecord,
    remove: removeRecord,
    importList: importList,
    exportJson: exportJson,
    durationMs: durationMs,
    formatDuration: formatDuration,
    formatDistanceM: formatDistanceM,
    formatDate: formatDate,
    formatTime: formatTime
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
