/**
 * Sheds — local-first search sessions, GPS tracks, and coverage marks (v0.2).
 * Private on-device only. Never claims a searched area has no sheds.
 */
(function (global) {
  "use strict";

  var SESSIONS_KEY = "waypoint-sheds-sessions-v1";
  var COVERAGE_KEY = "waypoint-sheds-coverage-v1";
  var SCHEMA_VERSION = 1;
  var MAX_SESSIONS = 80;
  var MAX_PATH_POINTS = 4000;
  var MAX_COVERAGE = 8000;

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function haversineM(aLat, aLng, bLat, bLng) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (bLat - aLat) * toRad;
    var dLng = (bLng - aLng) * toRad;
    var lat1 = aLat * toRad;
    var lat2 = bLat * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** ~45m cells for coverage buckets */
  function cellKey(lat, lng) {
    var qLat = Math.round(lat * 2000) / 2000;
    var qLng = Math.round(lng * 2000) / 2000;
    return qLat.toFixed(4) + "," + qLng.toFixed(4);
  }

  function parseList(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return [];
      var data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function writeList(key, arr, max) {
    try {
      localStorage.setItem(key, JSON.stringify((arr || []).slice(0, max)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function listSessions() {
    return parseList(SESSIONS_KEY).sort(function (a, b) {
      return String(b.startedAt || "").localeCompare(String(a.startedAt || ""));
    });
  }

  function getSession(id) {
    var all = listSessions();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function getActiveSession() {
    var all = listSessions();
    for (var i = 0; i < all.length; i++) if (all[i].status === "active") return all[i];
    return null;
  }

  function saveSession(session) {
    if (!session || !session.id) return false;
    var all = listSessions().filter(function (s) { return s.id !== session.id; });
    all.unshift(session);
    return writeList(SESSIONS_KEY, all, MAX_SESSIONS);
  }

  function startSession(meta) {
    meta = meta || {};
    var existing = getActiveSession();
    if (existing) return existing;
    var now = new Date().toISOString();
    var session = {
      schemaVersion: SCHEMA_VERSION,
      id: "sess_" + uuid(),
      status: "active",
      startedAt: now,
      endedAt: null,
      speciesId: meta.speciesId || "odocoileus-virginianus",
      searchAreaId: meta.searchAreaId || null,
      searchAreaName: meta.searchAreaName || null,
      path: [],
      distanceM: 0,
      durationMs: 0,
      observationIds: [],
      shedsFound: 0,
      notes: meta.notes || "",
      weatherSummary: meta.weatherSummary || null,
      modelVersion: meta.modelVersion || null,
      factorConfigVersion: meta.factorConfigVersion || null,
      activePreset: meta.activePreset || null,
      regionalContext: meta.regionalContext || null,
      dataCoverageSummary: meta.dataCoverageSummary || null,
      inputDataTimestamp: meta.inputDataTimestamp || now,
      createdAt: now,
      updatedAt: now
    };
    saveSession(session);
    return session;
  }

  function pathDistance(path) {
    var d = 0;
    var i;
    for (i = 1; i < path.length; i++) {
      d += haversineM(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
    }
    return d;
  }

  function appendTrackPoint(sessionId, lat, lng, t) {
    var session = getSession(sessionId);
    if (!session || session.status !== "active") return null;
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var point = { lat: lat, lng: lng, t: t || Date.now() };
    var path = session.path || [];
    var last = path[path.length - 1];
    if (last && haversineM(last.lat, last.lng, lat, lng) < 4) {
      // ignore GPS jitter
      return session;
    }
    path.push(point);
    if (path.length > MAX_PATH_POINTS) path = path.slice(path.length - MAX_PATH_POINTS);
    session.path = path;
    session.distanceM = Math.round(pathDistance(path));
    session.durationMs = Math.max(0, (point.t - Date.parse(session.startedAt)) || 0);
    session.updatedAt = new Date().toISOString();
    saveSession(session);
    // Auto partial coverage along track
    markCoverage(lat, lng, "partial", { sessionId: sessionId, source: "track" });
    return session;
  }

  function attachObservation(sessionId, observationId, type) {
    var session = getSession(sessionId);
    if (!session) return null;
    session.observationIds = session.observationIds || [];
    if (session.observationIds.indexOf(observationId) < 0) {
      session.observationIds.push(observationId);
    }
    if (type === "shed_found") session.shedsFound = (session.shedsFound || 0) + 1;
    session.updatedAt = new Date().toISOString();
    saveSession(session);
    return session;
  }

  function endSession(sessionId, extras) {
    extras = extras || {};
    var session = getSession(sessionId);
    if (!session) return null;
    session.status = "ended";
    session.endedAt = new Date().toISOString();
    session.durationMs = Math.max(
      session.durationMs || 0,
      Date.parse(session.endedAt) - Date.parse(session.startedAt)
    );
    if (extras.notes != null) session.notes = String(extras.notes);
    if (extras.weatherSummary) session.weatherSummary = extras.weatherSummary;
    session.updatedAt = session.endedAt;
    saveSession(session);
    return session;
  }

  /** Build end-of-search summary — never claims area empty of sheds. */
  function summarizeSession(session, observations) {
    if (!session) return null;
    observations = observations || [];
    var ids = session.observationIds || [];
    var linked = observations.filter(function (o) { return ids.indexOf(o.id) >= 0; });
    var byType = Object.create(null);
    linked.forEach(function (o) {
      byType[o.type] = (byType[o.type] || 0) + 1;
    });
    var hasPath = !!(session.path && session.path.length >= 2);
    return {
      sessionId: session.id,
      searchAreaId: session.searchAreaId || null,
      searchAreaName: session.searchAreaName || null,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: session.durationMs || 0,
      distanceM: hasPath ? (session.distanceM || 0) : null,
      distanceAvailable: hasPath,
      observationCount: linked.length,
      shedsFound: session.shedsFound || 0,
      byType: byType,
      notes: session.notes || "",
      disclaimer: "Past search does not prove an area is empty of sheds."
    };
  }

  /** Ensure legacy sessions have searchAreaId:null without changing ids. */
  function migrateSessionsIfNeeded() {
    var all = listSessions();
    var changed = false;
    all.forEach(function (s) {
      if (!s) return;
      if (s.searchAreaId === undefined) {
        s.searchAreaId = null;
        changed = true;
      }
      if (s.searchAreaName === undefined) {
        s.searchAreaName = null;
        changed = true;
      }
    });
    if (changed) writeList(SESSIONS_KEY, all, MAX_SESSIONS);
    return { migrated: changed, count: all.length };
  }

  function listCoverage() {
    return parseList(COVERAGE_KEY);
  }

  function coverageMap() {
    var map = Object.create(null);
    listCoverage().forEach(function (c) {
      map[c.key] = c;
    });
    return map;
  }

  var LEVEL_RANK = { partial: 1, revisit: 2, thorough: 3 };

  function markCoverage(lat, lng, level, meta) {
    meta = meta || {};
    level = level || "partial";
    if (!LEVEL_RANK[level]) level = "partial";
    var key = cellKey(lat, lng);
    var all = listCoverage();
    var found = null;
    var i;
    for (i = 0; i < all.length; i++) {
      if (all[i].key === key) { found = all[i]; break; }
    }
    if (found) {
      // Do not downgrade thorough → partial silently; revisit can override for planner preference
      if (level === "revisit" || (LEVEL_RANK[level] >= LEVEL_RANK[found.level || "partial"])) {
        found.level = level;
      }
      found.updatedAt = new Date().toISOString();
      found.lat = lat;
      found.lng = lng;
      found.sessionId = meta.sessionId || found.sessionId || null;
      found.source = meta.source || found.source || "user";
    } else {
      all.unshift({
        schemaVersion: SCHEMA_VERSION,
        key: key,
        lat: lat,
        lng: lng,
        level: level,
        sessionId: meta.sessionId || null,
        source: meta.source || "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    writeList(COVERAGE_KEY, all, MAX_COVERAGE);
    return coverageMap()[key];
  }

  function coverageLevelAt(lat, lng) {
    var hit = coverageMap()[cellKey(lat, lng)];
    return hit ? hit.level : null;
  }

  function coveragePenaltyFactor(level) {
    if (level === "thorough") return 0.35;
    if (level === "partial") return 0.62;
    if (level === "revisit") return 1.08;
    return 1;
  }

  function summarizeHistory(observations) {
    observations = observations || [];
    var byDay = Object.create(null);
    observations.forEach(function (o) {
      var day = String(o.observedAt || o.createdAt || "").slice(0, 10);
      if (!day) return;
      if (!byDay[day]) byDay[day] = { date: day, count: 0, sheds: 0, types: {} };
      byDay[day].count += 1;
      if (o.type === "shed_found") byDay[day].sheds += 1;
      byDay[day].types[o.type] = (byDay[day].types[o.type] || 0) + 1;
    });
    var sessions = listSessions();
    var totalDistance = sessions.reduce(function (a, s) { return a + (s.distanceM || 0); }, 0);
    var totalSheds = sessions.reduce(function (a, s) { return a + (s.shedsFound || 0); }, 0);
    return {
      days: Object.keys(byDay).sort().reverse().map(function (k) { return byDay[k]; }),
      sessionCount: sessions.length,
      totalDistanceM: totalDistance,
      totalShedsFound: totalSheds,
      coverageCells: listCoverage().length,
      thoroughCells: listCoverage().filter(function (c) { return c.level === "thorough"; }).length
    };
  }

  function exportBundle() {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      privacy: "private-local",
      sessions: listSessions(),
      coverage: listCoverage()
    };
  }

  function importBundle(bundle) {
    bundle = bundle || {};
    var incomingSessions = Array.isArray(bundle.sessions) ? bundle.sessions : [];
    var incomingCoverage = Array.isArray(bundle.coverage) ? bundle.coverage : [];
    var sessById = {};
    listSessions().forEach(function (s) {
      if (s && s.id) sessById[s.id] = s;
    });
    var added = 0;
    var replaced = 0;
    incomingSessions.forEach(function (raw) {
      if (!raw || !raw.id) return;
      var copy = Object.assign({}, raw);
      if (copy.status === "active") copy.status = "ended";
      if (sessById[copy.id]) replaced += 1;
      else added += 1;
      sessById[copy.id] = copy;
    });
    var mergedSessions = [];
    Object.keys(sessById).forEach(function (id) { mergedSessions.push(sessById[id]); });
    if (!writeList(SESSIONS_KEY, mergedSessions, MAX_SESSIONS)) {
      return { ok: false, error: "Could not save imported sessions.", added: 0, replaced: 0, coverageAdded: 0 };
    }
    var covByKey = {};
    listCoverage().forEach(function (c) {
      var key = (c && (c.cellKey || c.id)) || null;
      if (key) covByKey[key] = c;
    });
    var coverageAdded = 0;
    incomingCoverage.forEach(function (c) {
      if (!c) return;
      var key = c.cellKey || c.id;
      if (!key) return;
      if (!covByKey[key]) coverageAdded += 1;
      covByKey[key] = c;
    });
    var mergedCov = [];
    Object.keys(covByKey).forEach(function (k) { mergedCov.push(covByKey[k]); });
    writeList(COVERAGE_KEY, mergedCov, MAX_COVERAGE);
    return {
      ok: true,
      added: added,
      replaced: replaced,
      total: mergedSessions.length,
      coverageAdded: coverageAdded,
      coverageTotal: mergedCov.length
    };
  }

  global.WaypointShedsSessions = {
    SESSIONS_KEY: SESSIONS_KEY,
    COVERAGE_KEY: COVERAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    cellKey: cellKey,
    haversineM: haversineM,
    listSessions: listSessions,
    getSession: getSession,
    getActiveSession: getActiveSession,
    startSession: startSession,
    appendTrackPoint: appendTrackPoint,
    attachObservation: attachObservation,
    endSession: endSession,
    summarizeSession: summarizeSession,
    migrateSessionsIfNeeded: migrateSessionsIfNeeded,
    listCoverage: listCoverage,
    coverageMap: coverageMap,
    markCoverage: markCoverage,
    coverageLevelAt: coverageLevelAt,
    coveragePenaltyFactor: coveragePenaltyFactor,
    summarizeHistory: summarizeHistory,
    exportBundle: exportBundle,
    importBundle: importBundle
  };
})(window);
