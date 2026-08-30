/**
 * Sheds Phase 3 — Saved Search Areas (local-first).
 * Neutral naming: Search Area — never marketed as a find-probability zone.
 * Schema: waypoint-sheds-search-areas-v1
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "waypoint-sheds-search-areas-v1";
  var SCHEMA_VERSION = 1;
  var MAX_AREAS = 80;

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function isFiniteCoord(n) {
    return typeof n === "number" && isFinite(n);
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (!isFiniteCoord(Number(raw.center && raw.center.lat)) || !isFiniteCoord(Number(raw.center && raw.center.lng))) {
      return null;
    }
    var now = new Date().toISOString();
    var radiusM = typeof raw.radiusM === "number" && isFinite(raw.radiusM) ? raw.radiusM : 600;
    var radiusKey = raw.radiusKey || (radiusM <= 400 ? "small" : radiusM <= 600 ? "medium" : "large");
    var mapView = null;
    if (raw.mapView && isFiniteCoord(Number(raw.mapView.lat)) && isFiniteCoord(Number(raw.mapView.lng))) {
      mapView = {
        lat: Number(raw.mapView.lat),
        lng: Number(raw.mapView.lng),
        zoom: isFiniteCoord(Number(raw.mapView.zoom)) ? Number(raw.mapView.zoom) : 13
      };
    }
    var status = raw.status === "archived" ? "archived" : "active";
    return {
      schemaVersion: SCHEMA_VERSION,
      id: raw.id || ("area_" + uuid()),
      name: String(raw.name || "Search Area").trim().slice(0, 80) || "Search Area",
      center: { lat: Number(raw.center.lat), lng: Number(raw.center.lng) },
      radiusKey: radiusKey,
      radiusM: radiusM,
      mapView: mapView,
      notes: raw.notes != null ? String(raw.notes).slice(0, 800) : "",
      gisPackId: raw.gisPackId != null ? String(raw.gisPackId) : null,
      gisStatus: raw.gisStatus === "available" || raw.gisStatus === "unavailable" ? raw.gisStatus : "unknown",
      status: status,
      privacy: "private",
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now,
      archivedAt: status === "archived" ? (raw.archivedAt || now) : null
    };
  }

  function listRaw() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.map(normalize).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function persist(all) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify((all || []).slice(0, MAX_AREAS)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function list(opts) {
    opts = opts || {};
    var all = listRaw().sort(function (a, b) {
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
    if (opts.includeArchived) return all;
    return all.filter(function (a) { return a.status === "active"; });
  }

  function getById(id) {
    var all = listRaw();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function create(partial) {
    var area = normalize(Object.assign({}, partial, {
      id: "area_" + uuid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "active"
    }));
    if (!area) return { ok: false, error: "Invalid Search Area (need center)." };
    if (!String(partial && partial.name || "").trim()) {
      return { ok: false, error: "Name required." };
    }
    area.name = String(partial.name).trim().slice(0, 80);
    var all = listRaw();
    all.unshift(area);
    if (!persist(all)) return { ok: false, error: "Could not save locally." };
    return { ok: true, area: area };
  }

  function update(id, patch) {
    var all = listRaw();
    var idx = -1;
    var i;
    for (i = 0; i < all.length; i++) if (all[i].id === id) { idx = i; break; }
    if (idx < 0) return { ok: false, error: "Search Area not found." };
    var merged = Object.assign({}, all[idx], patch || {}, { id: id, createdAt: all[idx].createdAt });
    if (patch && patch.center) {
      merged.center = Object.assign({}, all[idx].center, patch.center);
    }
    if (patch && patch.mapView) {
      merged.mapView = patch.mapView;
    }
    merged.updatedAt = new Date().toISOString();
    var next = normalize(merged);
    if (!next) return { ok: false, error: "Invalid update." };
    all[idx] = next;
    if (!persist(all)) return { ok: false, error: "Could not save locally." };
    return { ok: true, area: next };
  }

  function rename(id, name) {
    var n = String(name || "").trim().slice(0, 80);
    if (!n) return { ok: false, error: "Name required." };
    return update(id, { name: n });
  }

  function archive(id) {
    return update(id, { status: "archived", archivedAt: new Date().toISOString() });
  }

  function unarchive(id) {
    return update(id, { status: "active", archivedAt: null });
  }

  /** Delete area only — never cascade to observations or sessions. */
  function remove(id) {
    var all = listRaw().filter(function (a) { return a.id !== id; });
    if (!persist(all)) return { ok: false, error: "Could not update storage." };
    return { ok: true, deletedId: id };
  }

  function fromSearchState(opts) {
    opts = opts || {};
    return {
      name: opts.name,
      center: { lat: opts.lat, lng: opts.lng },
      radiusKey: opts.radiusKey || "medium",
      radiusM: opts.radiusM || 600,
      mapView: opts.mapView || null,
      notes: opts.notes || "",
      gisPackId: opts.gisPackId || null,
      gisStatus: opts.gisStatus || "unknown"
    };
  }

  function exportJson() {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      privacy: "private-local",
      searchAreas: listRaw()
    };
  }

  function importList(records) {
    var incoming = Array.isArray(records) ? records : [];
    var byId = {};
    listRaw().forEach(function (a) {
      if (a && a.id) byId[a.id] = a;
    });
    var added = 0;
    var replaced = 0;
    incoming.forEach(function (raw) {
      var area = normalize(raw);
      if (!area || !area.id) return;
      if (byId[area.id]) replaced += 1;
      else added += 1;
      byId[area.id] = area;
    });
    var merged = [];
    Object.keys(byId).forEach(function (id) { merged.push(byId[id]); });
    if (!persist(merged)) return { ok: false, error: "Could not save imported search areas.", added: 0, replaced: 0, total: listRaw().length };
    return { ok: true, added: added, replaced: replaced, total: merged.length };
  }

  global.WaypointShedsSearchAreaStore = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_AREAS: MAX_AREAS,
    list: list,
    getById: getById,
    create: create,
    update: update,
    rename: rename,
    archive: archive,
    unarchive: unarchive,
    remove: remove,
    fromSearchState: fromSearchState,
    normalize: normalize,
    exportJson: exportJson,
    importList: importList
  };
})(typeof window !== "undefined" ? window : globalThis);
