/**
 * Sheds — local field-validation evidence (not automatic ground truth).
 */
(function (global) {
  "use strict";

  var KEY = "waypoint-sheds-validation-v1";
  var SCHEMA_VERSION = 1;
  var MAX = 400;

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function list() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function write(arr) {
    try {
      localStorage.setItem(KEY, JSON.stringify((arr || []).slice(0, MAX)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function create(record) {
    record = record || {};
    if (!isFinite(record.lat) || !isFinite(record.lng)) {
      return { ok: false, error: "Coordinates required." };
    }
    var now = new Date().toISOString();
    var item = {
      schemaVersion: SCHEMA_VERSION,
      id: "val_" + uuid(),
      createdAt: now,
      lat: Number(record.lat),
      lng: Number(record.lng),
      appearedPromising: record.appearedPromising || "unknown",
      deerSignEncountered: !!record.deerSignEncountered,
      beddingOrFeedingEvidence: !!record.beddingOrFeedingEvidence,
      accessOrObstacleNotes: String(record.accessOrObstacleNotes || "").slice(0, 400),
      shedOutcome: record.shedOutcome || "not_found", // found | not_found | unknown
      searchEffort: record.searchEffort || "partial", // light | partial | thorough
      confidence: record.confidence || "uncertain",
      notes: String(record.notes || "").slice(0, 800),
      // Evidence, not automatic model truth:
      treatAsBiologicalTruth: false,
      modelSnapshot: {
        modelVersion: record.modelVersion || null,
        factorConfigVersion: record.factorConfigVersion || null,
        activePreset: record.activePreset || null,
        regionalContext: record.regionalContext || null,
        dataCoverageSummary: record.dataCoverageSummary || null,
        inputTimestamp: record.inputTimestamp || now,
        cellPriority: record.cellPriority != null ? record.cellPriority : null,
        cellBand: record.cellBand || null
      },
      disclaimer:
        "A no-shed result does not mean the model was wrong. Visibility, prior collection, coverage, and timing all matter."
    };
    var all = list();
    all.unshift(item);
    write(all);
    return { ok: true, validation: item };
  }

  function remove(id) {
    var all = list().filter(function (v) { return v.id !== id; });
    write(all);
    return { ok: true };
  }

  function importList(records) {
    var incoming = Array.isArray(records) ? records : [];
    var byId = {};
    list().forEach(function (v) {
      if (v && v.id) byId[v.id] = v;
    });
    var added = 0;
    var replaced = 0;
    incoming.forEach(function (raw) {
      if (!raw || typeof raw !== "object") return;
      var item = Object.assign({}, raw);
      if (!item.id) item.id = "val_" + uuid();
      if (byId[item.id]) replaced += 1;
      else added += 1;
      byId[item.id] = item;
    });
    var merged = [];
    Object.keys(byId).forEach(function (id) { merged.push(byId[id]); });
    if (!write(merged)) return { ok: false, error: "Could not save imported validations.", added: 0, replaced: 0, total: list().length };
    return { ok: true, added: added, replaced: replaced, total: merged.length };
  }

  global.WaypointShedsValidation = {
    KEY: KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    list: list,
    create: create,
    remove: remove,
    importList: importList
  };
})(typeof window !== "undefined" ? window : globalThis);
