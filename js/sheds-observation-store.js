/**
 * Sheds — private field observations (local-first).
 * Schema: waypoint-sheds-observations-v1
 * Coordinates stay on-device. No public sharing in v0.1.
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "waypoint-sheds-observations-v1";
  var VIEW_KEY = "waypoint-sheds-map-view-v1";
  var MODEL_KEY = "waypoint-sheds-model-prefs-v1";
  var SCHEMA_VERSION = 2;
  var MAX_OBS = 500;

  var SPECIES_WHITETAIL = "odocoileus-virginianus";

  /** Prefer map-tap; YOU placement only when accuracy ≤ this (meters). */
  var OBS_GPS_ACCURACY_MAX_M = 80;

  var OBSERVATION_TYPES = [
    { id: "shed_found", label: "Shed found", group: "find", marker: "shed" },
    { id: "deer_seen", label: "Deer seen", group: "wildlife", marker: "deer" },
    { id: "deer_sign", label: "Deer sign", group: "sign", marker: "sign" },
    { id: "trail_crossing", label: "Trail or crossing", group: "travel", marker: "trail" },
    { id: "bedding_area", label: "Bedding evidence", group: "habitat", marker: "bed" },
    { id: "feeding_area", label: "Feeding evidence", group: "habitat", marker: "feed" },
    { id: "fence_crossing", label: "Fence crossing", group: "travel", marker: "fence" },
    { id: "winter_concentration", label: "Winter concentration area", group: "habitat", marker: "winter" },
    { id: "hunting_pressure", label: "Hunting pressure", group: "disturbance", marker: "hunt" },
    { id: "hiking_pressure", label: "Hiking / recreation pressure", group: "disturbance", marker: "hike" },
    { id: "human_disturbance", label: "Other human activity / pressure", group: "disturbance", marker: "disturb" },
    { id: "search_completed", label: "Search completed", group: "effort", marker: "search" },
    { id: "access_issue", label: "Access note", group: "access", marker: "access" },
    { id: "habitat_note", label: "Habitat note", group: "habitat", marker: "note" },
    { id: "other", label: "General field note", group: "other", marker: "other" }
  ];

  var SIGN_DETAIL = ["unknown", "tracks", "scat", "rub", "scrape", "other_sign"];

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function typeMeta(id) {
    for (var i = 0; i < OBSERVATION_TYPES.length; i++) {
      if (OBSERVATION_TYPES[i].id === id) return OBSERVATION_TYPES[i];
    }
    return OBSERVATION_TYPES[OBSERVATION_TYPES.length - 1];
  }

  function isFiniteCoord(n) {
    return typeof n === "number" && isFinite(n);
  }

  function validateObservation(obs) {
    if (!obs || typeof obs !== "object") return { ok: false, error: "Invalid observation." };
    if (!obs.id || typeof obs.id !== "string") return { ok: false, error: "Missing id." };
    if (!typeMeta(obs.type).id || obs.type !== typeMeta(obs.type).id) {
      if (!OBSERVATION_TYPES.some(function (t) { return t.id === obs.type; })) {
        return { ok: false, error: "Unknown observation type." };
      }
    }
    if (!obs.location || !isFiniteCoord(obs.location.lat) || !isFiniteCoord(obs.location.lng)) {
      return { ok: false, error: "Coordinates required." };
    }
    if (obs.location.lat < -90 || obs.location.lat > 90 || obs.location.lng < -180 || obs.location.lng > 180) {
      return { ok: false, error: "Coordinates out of range." };
    }
    return { ok: true };
  }

  var SEX_VALUES = ["unknown", "buck", "doe", "fawn_unknown"];
  var CLASS_VALUES = ["unknown", "fawn", "yearling", "mature", "not_applicable"];

  function normalizeSex(v) {
    var s = v != null ? String(v) : "unknown";
    return SEX_VALUES.indexOf(s) >= 0 ? s : "unknown";
  }

  function normalizeClass(v) {
    var s = v != null ? String(v) : "unknown";
    return CLASS_VALUES.indexOf(s) >= 0 ? s : "unknown";
  }

  function normalizeWeatherSnapshot(raw) {
    if (!raw || typeof raw !== "object") return null;
    var snap = {
      capturedAt: raw.capturedAt || null,
      source: raw.source || null,
      tempC: typeof raw.tempC === "number" ? raw.tempC : null,
      windSpeedMs: typeof raw.windSpeedMs === "number" ? raw.windSpeedMs : null,
      snowMm: typeof raw.snowMm === "number" ? raw.snowMm : null,
      precipMm24h: typeof raw.precipMm24h === "number" ? raw.precipMm24h : null,
      pressureHpa: typeof raw.pressureHpa === "number" ? raw.pressureHpa : null
    };
    var has = snap.tempC != null || snap.windSpeedMs != null || snap.snowMm != null ||
      snap.precipMm24h != null || snap.pressureHpa != null;
    return has ? snap : null;
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    var now = new Date().toISOString();
    var type = raw.type || "other";
    var details = raw.details && typeof raw.details === "object" ? Object.assign({}, raw.details) : {};
    var precision = (raw.location && raw.location.precision) || "exact";
    if (precision !== "map-tap" && precision !== "gps" && precision !== "approximate" && precision !== "exact") {
      precision = "exact";
    }
    var accuracyM = raw.location && typeof raw.location.accuracyM === "number" && isFinite(raw.location.accuracyM)
      ? raw.location.accuracyM
      : (typeof raw.accuracyM === "number" && isFinite(raw.accuracyM) ? raw.accuracyM : null);
    if (accuracyM != null && accuracyM > OBS_GPS_ACCURACY_MAX_M && precision === "gps") {
      precision = "approximate";
    }
    var obs = {
      schemaVersion: SCHEMA_VERSION,
      id: raw.id || ("obs_" + uuid()),
      type: type,
      speciesId: raw.speciesId || SPECIES_WHITETAIL,
      location: {
        lat: Number(raw.location && raw.location.lat),
        lng: Number(raw.location && raw.location.lng),
        precision: precision,
        accuracyM: accuracyM,
        privacy: "private"
      },
      privacy: "private",
      searchAreaId: raw.searchAreaId != null && String(raw.searchAreaId).trim()
        ? String(raw.searchAreaId).trim()
        : null,
      observedAt: raw.observedAt || now,
      note: raw.note != null ? String(raw.note) : "",
      confidence: raw.confidence || "uncertain",
      quantity: raw.quantity == null || raw.quantity === "" ? null : Number(raw.quantity),
      details: details,
      weatherSnapshot: normalizeWeatherSnapshot(raw.weatherSnapshot || details.weatherSnapshot),
      photoRef: raw.photoRef != null && String(raw.photoRef).trim()
        ? String(raw.photoRef).trim().slice(0, 240)
        : (details.photoRef ? String(details.photoRef).trim().slice(0, 240) : null),
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now
    };
    if (type === "deer_seen" || type === "deer_sign") {
      obs.details.sex = normalizeSex(details.sex);
      obs.details.class = normalizeClass(details.class);
    }
    if (type === "deer_sign") {
      var sd = details.signDetail != null ? String(details.signDetail) : "unknown";
      obs.details.signDetail = SIGN_DETAIL.indexOf(sd) >= 0 ? sd : "unknown";
    }
    if (type === "shed_found") {
      obs.details = Object.assign({
        side: "unknown",
        freshness: "unknown",
        antlerCount: 1,
        collected: false
      }, obs.details);
    }
    return obs;
  }

  function safeParseList(raw) {
    try {
      var data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.map(normalize).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function list() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return safeParseList(raw);
    } catch (e) {
      return [];
    }
  }

  function persist(all) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, MAX_OBS)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function getById(id) {
    var all = list();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  function create(partial) {
    var obs = normalize(Object.assign({}, partial, {
      id: "obs_" + uuid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    var check = validateObservation(obs);
    if (!check.ok) return { ok: false, error: check.error };
    var all = list();
    all.unshift(obs);
    if (!persist(all)) return { ok: false, error: "Could not save locally (storage full or blocked)." };
    return { ok: true, observation: obs };
  }

  function update(id, patch) {
    var all = list();
    var idx = -1;
    for (var i = 0; i < all.length; i++) if (all[i].id === id) { idx = i; break; }
    if (idx < 0) return { ok: false, error: "Observation not found." };
    var next = normalize(Object.assign({}, all[idx], patch, {
      id: id,
      createdAt: all[idx].createdAt,
      updatedAt: new Date().toISOString(),
      location: Object.assign({}, all[idx].location, patch.location || {}),
      details: Object.assign({}, all[idx].details || {}, patch.details || {})
    }));
    var check = validateObservation(next);
    if (!check.ok) return { ok: false, error: check.error };
    all[idx] = next;
    if (!persist(all)) return { ok: false, error: "Could not save locally." };
    return { ok: true, observation: next };
  }

  function remove(id) {
    var all = list().filter(function (o) { return o.id !== id; });
    if (!persist(all)) return { ok: false, error: "Could not update storage." };
    return { ok: true };
  }

  function exportJson() {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      privacy: "private-local",
      speciesFocus: SPECIES_WHITETAIL,
      observations: list()
    };
  }

  /** Merge by id. Incoming records with the same id replace existing ones. */
  function importList(records) {
    var incoming = Array.isArray(records) ? records : [];
    var byId = {};
    list().forEach(function (o) {
      if (o && o.id) byId[o.id] = o;
    });
    var added = 0;
    var replaced = 0;
    incoming.forEach(function (raw) {
      var obs = normalize(raw);
      if (!obs || !obs.id) return;
      if (byId[obs.id]) replaced += 1;
      else added += 1;
      byId[obs.id] = obs;
    });
    var merged = [];
    Object.keys(byId).forEach(function (id) { merged.push(byId[id]); });
    merged.sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    });
    if (!persist(merged)) return { ok: false, error: "Could not save imported observations.", added: 0, replaced: 0, total: list().length };
    return { ok: true, added: added, replaced: replaced, total: merged.length };
  }

  function canPlaceFromGps(accuracyM) {
    return accuracyM != null && isFinite(accuracyM) && accuracyM > 0 && accuracyM <= OBS_GPS_ACCURACY_MAX_M;
  }

  /**
   * Observations for a Search Area — linked OR inside radius; each id counted once.
   */
  function listForSearchArea(area, opts) {
    opts = opts || {};
    if (!area || !area.center) return [];
    var radiusM = area.radiusM || 600;
    var SearchArea = global.WaypointShedsSearchArea;
    var haversine = SearchArea && SearchArea.haversineM
      ? SearchArea.haversineM
      : function (a, b, c, d) {
          var R = 6371000;
          var toRad = Math.PI / 180;
          var dLat = (c - a) * toRad;
          var dLng = (d - b) * toRad;
          var x =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a * toRad) * Math.cos(c * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
          return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
        };
    var seen = Object.create(null);
    var out = [];
    list().forEach(function (o) {
      if (!o || !o.id || seen[o.id]) return;
      var linked = area.id && o.searchAreaId === area.id;
      var inside = false;
      if (o.location && isFiniteCoord(o.location.lat) && isFiniteCoord(o.location.lng)) {
        inside = haversine(area.center.lat, area.center.lng, o.location.lat, o.location.lng) <= radiusM;
      }
      if (opts.linkedOnly && !linked) return;
      if (opts.insideOnly && !inside) return;
      if (!opts.linkedOnly && !opts.insideOnly && !(linked || inside)) return;
      seen[o.id] = true;
      out.push(o);
    });
    return out;
  }

  /** Migrate v1→v2 in place: ensure searchAreaId null, schemaVersion 2 — no id changes. */
  function migrateIfNeeded() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return { migrated: false, count: 0 };
    }
    if (!raw) return { migrated: false, count: 0 };
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e2) {
      return { migrated: false, count: 0 };
    }
    if (!Array.isArray(data)) return { migrated: false, count: 0 };
    var changed = false;
    var next = data.map(function (o) {
      if (!o || typeof o !== "object") return o;
      var needs =
        o.schemaVersion !== SCHEMA_VERSION ||
        o.searchAreaId === undefined ||
        !(o.location && Object.prototype.hasOwnProperty.call(o.location, "accuracyM"));
      if (needs) {
        changed = true;
        return normalize(Object.assign({}, o, {
          searchAreaId: o.searchAreaId != null ? o.searchAreaId : null,
          schemaVersion: SCHEMA_VERSION
        }));
      }
      return normalize(o);
    }).filter(Boolean);
    if (changed) persist(next);
    return { migrated: changed, count: next.length };
  }

  function defaultModelPrefs() {
    return {
      schemaVersion: 2,
      heatVisible: true,
      obsVisible: true,
      coverageVisible: true,
      showConfidence: false,
      diagnosticMode: false,
      compareMode: false,
      /** Phase 3: observations do NOT modify Habitat MODEL unless explicitly enabled. */
      includeObservationsInHabitat: false,
      searchAreasVisible: false,
      opacity: 0.42,
      activePreset: "balanced",
      seasonPhaseOverride: null,
      weights: {
        season: "balanced",
        slope: "balanced",
        aspect: "balanced",
        terrainForm: "balanced",
        thermalCover: "balanced",
        feeding: "balanced",
        bedding: "balanced",
        edges: "balanced",
        corridors: "balanced",
        deerSign: "balanced",
        fences: "balanced",
        shedFinds: "balanced",
        humanPressure: "balanced",
        searchHistory: "balanced",
        snow: "balanced"
      }
    };
  }

  function loadModelPrefs() {
    try {
      var raw = localStorage.getItem(MODEL_KEY);
      if (!raw) return defaultModelPrefs();
      var parsed = JSON.parse(raw);
      var base = defaultModelPrefs();
      return {
        schemaVersion: 2,
        heatVisible: parsed.heatVisible !== false,
        obsVisible: parsed.obsVisible !== false,
        coverageVisible: parsed.coverageVisible !== false,
        showConfidence: !!parsed.showConfidence,
        diagnosticMode: !!parsed.diagnosticMode,
        compareMode: !!parsed.compareMode,
        includeObservationsInHabitat: parsed.includeObservationsInHabitat === true,
        searchAreasVisible: parsed.searchAreasVisible === true,
        opacity: typeof parsed.opacity === "number" ? parsed.opacity : 0.42,
        activePreset: parsed.activePreset || "balanced",
        seasonPhaseOverride: parsed.seasonPhaseOverride || null,
        weights: Object.assign({}, base.weights, parsed.weights || {})
      };
    } catch (e) {
      return defaultModelPrefs();
    }
  }

  function loadMapView() {
    try {
      var raw = localStorage.getItem(VIEW_KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || !isFiniteCoord(v.lat) || !isFiniteCoord(v.lng)) return null;
      return {
        lat: v.lat,
        lng: v.lng,
        zoom: isFiniteCoord(v.zoom) ? v.zoom : 12
      };
    } catch (e) {
      return null;
    }
  }

  function saveMapView(view) {
    if (!view || !isFiniteCoord(view.lat) || !isFiniteCoord(view.lng)) return;
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({
        lat: view.lat,
        lng: view.lng,
        zoom: view.zoom || 12,
        savedAt: new Date().toISOString()
      }));
    } catch (e) { /* ignore */ }
  }

  function saveModelPrefs(prefs) {
    try {
      localStorage.setItem(MODEL_KEY, JSON.stringify(prefs));
      return true;
    } catch (e) {
      return false;
    }
  }

  global.WaypointShedsObservations = {
    STORAGE_KEY: STORAGE_KEY,
    VIEW_KEY: VIEW_KEY,
    MODEL_KEY: MODEL_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    SPECIES_WHITETAIL: SPECIES_WHITETAIL,
    OBS_GPS_ACCURACY_MAX_M: OBS_GPS_ACCURACY_MAX_M,
    OBSERVATION_TYPES: OBSERVATION_TYPES,
    SIGN_DETAIL: SIGN_DETAIL,
    SEX_VALUES: SEX_VALUES,
    CLASS_VALUES: CLASS_VALUES,
    typeMeta: typeMeta,
    list: list,
    getById: getById,
    create: create,
    update: update,
    remove: remove,
    validate: validateObservation,
    normalize: normalize,
    normalizeWeatherSnapshot: normalizeWeatherSnapshot,
    exportJson: exportJson,
    importList: importList,
    loadMapView: loadMapView,
    saveMapView: saveMapView,
    defaultModelPrefs: defaultModelPrefs,
    loadModelPrefs: loadModelPrefs,
    saveModelPrefs: saveModelPrefs,
    canPlaceFromGps: canPlaceFromGps,
    listForSearchArea: listForSearchArea,
    migrateIfNeeded: migrateIfNeeded
  };
})(typeof window !== "undefined" ? window : globalThis);
