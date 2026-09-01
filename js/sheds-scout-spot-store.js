/**
 * Sheds V1.4 — Scout Spots (local-first field planning).
 *
 * A Scout Spot is a hunter-saved candidate location to inspect later.
 * It is not a deer pin, antler probability, or find claim.
 *
 * Schema: waypoint-sheds-scout-spots-v1
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "waypoint-sheds-scout-spots-v1";
  var SCHEMA_VERSION = 1;
  var MAX_SPOTS = 120;
  var NAME_MAX = 80;
  var NOTE_MAX = 400;
  var STATUSES = Object.freeze(["Plan", "Checked", "Revisit"]);
  var PRIORITIES = Object.freeze(["Higher", "Moderate", "Lower"]);
  var TERRAIN_STATUSES = Object.freeze([
    "ready",
    "unavailable",
    "failed",
    "incomplete",
    "insufficient_zoom"
  ]);
  var FIELD_NOTE =
    "Use the terrain as a search guide, not evidence that sheds are present.";

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function isFiniteCoord(n) {
    return typeof n === "number" && isFinite(n);
  }

  function finiteNum(n) {
    return typeof n === "number" && isFinite(n) ? n : null;
  }

  function clip(s, max) {
    return String(s == null ? "" : s).slice(0, max);
  }

  function emptyTerrain() {
    return {
      available: false,
      status: "unavailable",
      searchPriority: null,
      featureKind: null,
      featureLabel: null,
      slopeDeg: null,
      aspectDeg: null,
      aspectCardinal: null,
      elevM: null,
      why: []
    };
  }

  function emptyToday() {
    return {
      available: false,
      capturedAt: null,
      band: null,
      huntStatus: null,
      seasonCategory: null,
      seasonLabel: null,
      freezeThawStatus: null,
      freezeThawLabel: null,
      tempTrendStatus: null,
      tempTrendLabel: null,
      snowCoverStatus: null,
      snowCoverLabel: null
    };
  }

  function normalizeStatus(v) {
    var s = v != null ? String(v) : "Plan";
    return STATUSES.indexOf(s) >= 0 ? s : "Plan";
  }

  function normalizePriority(v) {
    return PRIORITIES.indexOf(v) >= 0 ? v : null;
  }

  function normalizeTerrainStatus(v) {
    if (v === "loading" || v === "idle" || v == null || v === "") return "unavailable";
    return TERRAIN_STATUSES.indexOf(v) >= 0 ? v : "unavailable";
  }

  function normalizeWhy(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    var i;
    for (i = 0; i < raw.length && out.length < 3; i++) {
      var line = String(raw[i] || "").trim();
      if (line) out.push(line.slice(0, 240));
    }
    return out;
  }

  function normalizeTerrain(raw) {
    if (!raw || typeof raw !== "object") return emptyTerrain();
    var status = normalizeTerrainStatus(raw.status);
    var priority = normalizePriority(raw.searchPriority || raw.priority);
    var ready = status === "ready" && !!priority;
    return {
      available: ready,
      status: status,
      searchPriority: ready ? priority : null,
      featureKind: raw.featureKind != null && String(raw.featureKind).trim()
        ? String(raw.featureKind).trim().slice(0, 80)
        : null,
      featureLabel: raw.featureLabel != null && String(raw.featureLabel).trim()
        ? String(raw.featureLabel).trim().slice(0, 160)
        : null,
      slopeDeg: finiteNum(raw.slopeDeg),
      aspectDeg: finiteNum(raw.aspectDeg),
      aspectCardinal: raw.aspectCardinal != null && String(raw.aspectCardinal).trim()
        ? String(raw.aspectCardinal).trim().slice(0, 8)
        : null,
      elevM: finiteNum(raw.elevM),
      why: normalizeWhy(raw.why)
    };
  }

  function normalizeToday(raw) {
    if (!raw || typeof raw !== "object") return emptyToday();
    var available = raw.available === true;
    var snap = {
      available: available,
      capturedAt: available && raw.capturedAt ? String(raw.capturedAt) : null,
      band: available && raw.band ? String(raw.band).slice(0, 40) : null,
      huntStatus: available && raw.huntStatus ? String(raw.huntStatus).slice(0, 40) : null,
      seasonCategory: available && raw.seasonCategory ? String(raw.seasonCategory).slice(0, 40) : null,
      seasonLabel: available && raw.seasonLabel ? String(raw.seasonLabel).slice(0, 80) : null,
      freezeThawStatus: available && raw.freezeThawStatus ? String(raw.freezeThawStatus).slice(0, 40) : null,
      freezeThawLabel: available && raw.freezeThawLabel ? String(raw.freezeThawLabel).slice(0, 160) : null,
      tempTrendStatus: available && raw.tempTrendStatus ? String(raw.tempTrendStatus).slice(0, 40) : null,
      tempTrendLabel: available && raw.tempTrendLabel ? String(raw.tempTrendLabel).slice(0, 160) : null,
      snowCoverStatus: available && raw.snowCoverStatus ? String(raw.snowCoverStatus).slice(0, 40) : null,
      snowCoverLabel: available && raw.snowCoverLabel ? String(raw.snowCoverLabel).slice(0, 160) : null
    };
    if (!snap.available) return emptyToday();
    return snap;
  }

  function defaultName(terrain) {
    var t = terrain || emptyTerrain();
    if (t.featureLabel) {
      return String(t.featureLabel).replace(/\.$/, "").slice(0, NAME_MAX);
    }
    if (t.searchPriority) return ("Scout Spot · " + t.searchPriority).slice(0, NAME_MAX);
    return "Scout Spot";
  }

  /**
   * Snapshot terrain from a V1.3 evaluatePoint result. Missing/failed never
   * becomes Moderate.
   */
  function terrainFromPriority(result) {
    if (!result || typeof result !== "object") return emptyTerrain();
    var feature = result.feature || {};
    var raw = result.raw || {};
    return normalizeTerrain({
      status: result.status,
      searchPriority: result.priority,
      featureKind: feature.kind || feature.id || null,
      featureLabel: feature.label || null,
      slopeDeg: raw.slopeDeg,
      aspectDeg: raw.aspectDeg,
      aspectCardinal: feature.aspectCardinal || raw.aspectCardinal || null,
      elevM: raw.elevM,
      why: result.why
    });
  }

  /**
   * Historical Today's Hunt snapshot. Null hunt → unavailable, not invented.
   */
  function snapshotFromHunt(hunt) {
    if (!hunt || typeof hunt !== "object") return emptyToday();
    if (hunt.status === "loading") return emptyToday();
    if (hunt.status === "need_location") return emptyToday();
    var ch = hunt.channels || {};
    var freeze = ch.freezeThaw || {};
    var trend = ch.tempTrend || {};
    var snow = ch.snowCover || {};
    return normalizeToday({
      available: true,
      capturedAt: new Date().toISOString(),
      band: hunt.band || null,
      huntStatus: hunt.status || null,
      seasonCategory: hunt.season && hunt.season.category,
      seasonLabel: hunt.season && hunt.season.label,
      freezeThawStatus: freeze.status || null,
      freezeThawLabel: freeze.label || freeze.detail || null,
      tempTrendStatus: trend.status || null,
      tempTrendLabel: trend.label || trend.detail || null,
      snowCoverStatus: snow.status || null,
      snowCoverLabel: snow.label || snow.detail || null
    });
  }

  function formatSavedContext(snap) {
    snap = normalizeToday(snap);
    if (!snap.available) {
      return {
        heading: "Saved context",
        lines: ["Today’s Hunt was unavailable when this Scout Spot was saved."],
        disclaimer: "This is historical field-planning context, not current conditions."
      };
    }
    var lines = [];
    if (snap.band) lines.push(snap.band + (snap.seasonLabel ? " · " + snap.seasonLabel : ""));
    else if (snap.seasonLabel) lines.push(snap.seasonLabel);
    if (snap.freezeThawLabel) lines.push(snap.freezeThawLabel);
    else if (snap.freezeThawStatus) lines.push("Freeze/thaw: " + snap.freezeThawStatus);
    if (snap.tempTrendLabel) lines.push(snap.tempTrendLabel);
    else if (snap.tempTrendStatus) lines.push("Temperature trend: " + snap.tempTrendStatus);
    if (snap.snowCoverLabel) lines.push(snap.snowCoverLabel);
    else if (snap.snowCoverStatus) lines.push("Snow: " + snap.snowCoverStatus);
    if (!lines.length) lines.push("A hunt snapshot was stored, with limited detail.");
    return {
      heading: "Saved context",
      capturedAt: snap.capturedAt,
      lines: lines,
      disclaimer: "This is the context when the spot was saved — not today’s conditions."
    };
  }

  function formatLiveToday(hunt) {
    if (!hunt || hunt.status === "loading") {
      return {
        heading: "Today",
        lines: ["Reading today’s hunt…"],
        disclaimer: "Live hunt context is separate from the saved snapshot."
      };
    }
    if (!hunt || hunt.status === "need_location") {
      return {
        heading: "Today",
        lines: ["Need location to read today’s hunt."],
        disclaimer: "Live hunt context is separate from the saved snapshot."
      };
    }
    var lines = [];
    if (hunt.band) lines.push(hunt.band + (hunt.season && hunt.season.label ? " · " + hunt.season.label : ""));
    if (hunt.conditions && hunt.conditions.length) {
      lines = lines.concat(hunt.conditions.slice(0, 3));
    }
    if (!lines.length) lines.push("Today’s Hunt is available, with limited detail.");
    return {
      heading: "Today",
      lines: lines,
      disclaimer: "Live hunt context is separate from the saved snapshot. It does not change terrain search priority."
    };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    var lat = Number(raw.location && raw.location.lat != null ? raw.location.lat : raw.lat);
    var lng = Number(raw.location && raw.location.lng != null ? raw.location.lng : raw.lng);
    if (!isFiniteCoord(lat) || !isFiniteCoord(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    var now = new Date().toISOString();
    var terrain = normalizeTerrain(raw.terrain);
    var name = String(raw.name || "").trim().slice(0, NAME_MAX);
    if (!name) name = defaultName(terrain);
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: "scout-spot",
      id: raw.id && String(raw.id).trim() ? String(raw.id).trim().slice(0, 80) : ("spot_" + uuid()),
      name: name,
      status: normalizeStatus(raw.status),
      location: { lat: lat, lng: lng, privacy: "private" },
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || raw.createdAt || now,
      note: clip(raw.note, NOTE_MAX),
      terrain: terrain,
      savedToday: normalizeToday(raw.savedToday),
      privacy: "private",
      fieldNote: FIELD_NOTE
    };
  }

  function recordsFromStorage(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray(data.scoutSpots)) return data.scoutSpots;
    return null;
  }

  function listRaw() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var records = recordsFromStorage(JSON.parse(raw));
      if (!records) return [];
      return records.map(normalize).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function persist(all) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        scoutSpots: (all || []).slice(0, MAX_SPOTS)
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function list() {
    return listRaw().sort(function (a, b) {
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
  }

  function getById(id) {
    var all = listRaw();
    var i;
    for (i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function create(partial) {
    var now = new Date().toISOString();
    var spot = normalize(Object.assign({}, partial, {
      id: "spot_" + uuid(),
      createdAt: now,
      updatedAt: now,
      status: (partial && partial.status) || "Plan"
    }));
    if (!spot) return { ok: false, error: "A Scout Spot needs a map location." };
    var all = listRaw();
    if (all.length >= MAX_SPOTS) {
      return {
        ok: false,
        error: "This device already has " + MAX_SPOTS + " Scout Spots. Delete one to save another."
      };
    }
    all.unshift(spot);
    if (!persist(all)) {
      return { ok: false, error: "Could not save locally. Storage may be full or unavailable." };
    }
    return { ok: true, spot: spot };
  }

  function update(id, patch) {
    var all = listRaw();
    var idx = -1;
    var i;
    for (i = 0; i < all.length; i++) if (all[i].id === id) { idx = i; break; }
    if (idx < 0) return { ok: false, error: "Scout Spot not found." };
    var merged = Object.assign({}, all[idx], patch || {}, {
      id: id,
      createdAt: all[idx].createdAt,
      location: all[idx].location,
      terrain: all[idx].terrain,
      savedToday: all[idx].savedToday
    });
    if (patch && patch.location) {
      merged.location = Object.assign({}, all[idx].location, patch.location);
    }
    if (patch && patch.terrain) merged.terrain = patch.terrain;
    if (patch && patch.savedToday) merged.savedToday = patch.savedToday;
    if (patch && Object.prototype.hasOwnProperty.call(patch, "note")) merged.note = patch.note;
    if (patch && Object.prototype.hasOwnProperty.call(patch, "name")) merged.name = patch.name;
    if (patch && patch.status) merged.status = patch.status;
    merged.updatedAt = new Date().toISOString();
    var next = normalize(merged);
    if (!next) return { ok: false, error: "Invalid update." };
    all[idx] = next;
    if (!persist(all)) {
      return { ok: false, error: "Could not save locally. Storage may be full or unavailable." };
    }
    return { ok: true, spot: next };
  }

  function rename(id, name) {
    var n = String(name || "").trim().slice(0, NAME_MAX);
    if (!n) return { ok: false, error: "Name required." };
    return update(id, { name: n });
  }

  function setNote(id, note) {
    return update(id, { note: clip(note, NOTE_MAX) });
  }

  function setStatus(id, status) {
    if (STATUSES.indexOf(status) < 0) return { ok: false, error: "Unknown status." };
    return update(id, { status: status });
  }

  function remove(id) {
    var all = listRaw().filter(function (s) { return s.id !== id; });
    if (!persist(all)) {
      return { ok: false, error: "Could not update storage." };
    }
    var HuntPlans = global.WaypointShedsHuntPlans;
    if (HuntPlans && typeof HuntPlans.removeSpotFromAll === "function") {
      HuntPlans.removeSpotFromAll(id);
    }
    return { ok: true, deletedId: id };
  }

  function exportJson() {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      privacy: "private-local",
      scoutSpots: listRaw()
    };
  }

  function importList(records) {
    var incoming = Array.isArray(records) ? records : [];
    var byId = {};
    listRaw().forEach(function (s) {
      if (s && s.id) byId[s.id] = s;
    });
    var added = 0;
    var replaced = 0;
    var skipped = 0;
    var count = Object.keys(byId).length;
    incoming.forEach(function (raw) {
      var spot = normalize(raw);
      if (!spot || !spot.id) {
        skipped += 1;
        return;
      }
      if (byId[spot.id]) {
        var prev = byId[spot.id];
        spot.createdAt = prev.createdAt;
        if (!(spot.terrain && spot.terrain.available) && prev.terrain && prev.terrain.available) {
          spot.terrain = prev.terrain;
        }
        if (!(spot.savedToday && spot.savedToday.available) && prev.savedToday && prev.savedToday.available) {
          spot.savedToday = prev.savedToday;
        }
        byId[spot.id] = spot;
        replaced += 1;
        return;
      }
      if (count >= MAX_SPOTS) {
        skipped += 1;
        return;
      }
      byId[spot.id] = spot;
      added += 1;
      count += 1;
    });
    var merged = [];
    Object.keys(byId).forEach(function (id) { merged.push(byId[id]); });
    if (!persist(merged)) {
      return {
        ok: false,
        error: "Could not save imported Scout Spots.",
        added: 0,
        replaced: 0,
        skipped: skipped,
        total: listRaw().length
      };
    }
    return { ok: true, added: added, replaced: replaced, skipped: skipped, total: listRaw().length };
  }

  global.WaypointShedsScoutSpots = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_SPOTS: MAX_SPOTS,
    STATUSES: STATUSES,
    PRIORITIES: PRIORITIES,
    FIELD_NOTE: FIELD_NOTE,
    emptyTerrain: emptyTerrain,
    emptyToday: emptyToday,
    normalize: normalize,
    defaultName: defaultName,
    terrainFromPriority: terrainFromPriority,
    snapshotFromHunt: snapshotFromHunt,
    formatSavedContext: formatSavedContext,
    formatLiveToday: formatLiveToday,
    list: list,
    getById: getById,
    create: create,
    update: update,
    rename: rename,
    setNote: setNote,
    setStatus: setStatus,
    remove: remove,
    exportJson: exportJson,
    importList: importList
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
