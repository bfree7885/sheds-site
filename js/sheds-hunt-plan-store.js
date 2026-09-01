/**
 * Sheds V1.5 — Hunt Plans (local-first field planning).
 *
 * A Hunt Plan is an ordered list of Scout Spot ids the hunter intends to check.
 * It is not a route, a deer path, a find prediction, or a probability model.
 *
 * Schema: waypoint-sheds-hunt-plans-v1
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "waypoint-sheds-hunt-plans-v1";
  var SCHEMA_VERSION = 1;
  var MAX_PLANS = 40;
  var MAX_SPOTS_PER_PLAN = 20;
  var NAME_MAX = 80;
  var NOTE_MAX = 400;
  var STATUSES = Object.freeze(["Planned", "Active", "Completed"]);
  var FIELD_NOTE =
    "A Hunt Plan is an intended search sequence of candidate locations — not a route and not evidence that sheds are present.";

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function clip(s, max) {
    return String(s == null ? "" : s).slice(0, max);
  }

  function normalizeStatus(v) {
    var s = v != null ? String(v) : "Planned";
    return STATUSES.indexOf(s) >= 0 ? s : "Planned";
  }

  function normalizeSpotIds(raw) {
    var src = Array.isArray(raw) ? raw : [];
    var seen = {};
    var out = [];
    var i;
    for (i = 0; i < src.length && out.length < MAX_SPOTS_PER_PLAN; i++) {
      var id = src[i] != null ? String(src[i]).trim().slice(0, 80) : "";
      if (!id || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    return out;
  }

  function defaultName(ids) {
    var n = ids && ids.length ? ids.length : 0;
    if (n === 1) return "Hunt Plan · 1 Scout Spot";
    if (n > 1) return "Hunt Plan · " + n + " Scout Spots";
    return "Hunt Plan";
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    var ids = normalizeSpotIds(raw.scoutSpotIds || raw.spots || raw.scoutSpots);
    var now = new Date().toISOString();
    var name = String(raw.name || "").trim().slice(0, NAME_MAX);
    if (!name) name = defaultName(ids);
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: "hunt-plan",
      id: raw.id && String(raw.id).trim() ? String(raw.id).trim().slice(0, 80) : ("plan_" + uuid()),
      name: name,
      status: normalizeStatus(raw.status),
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || raw.createdAt || now,
      scoutSpotIds: ids,
      note: clip(raw.note, NOTE_MAX),
      privacy: "private-local",
      fieldNote: FIELD_NOTE
    };
  }

  function recordsFromStorage(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray(data.huntPlans)) return data.huntPlans;
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
        huntPlans: (all || []).slice(0, MAX_PLANS)
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
    var ids = normalizeSpotIds(partial && (partial.scoutSpotIds || partial.spots));
    if (!ids.length) {
      return { ok: false, error: "A Hunt Plan needs at least one Scout Spot." };
    }
    var plan = normalize(Object.assign({}, partial, {
      id: "plan_" + uuid(),
      createdAt: now,
      updatedAt: now,
      scoutSpotIds: ids,
      status: (partial && partial.status) || "Planned"
    }));
    if (!plan) return { ok: false, error: "Could not create Hunt Plan." };
    var all = listRaw();
    if (all.length >= MAX_PLANS) {
      return {
        ok: false,
        error: "This device already has " + MAX_PLANS + " Hunt Plans. Delete one to save another."
      };
    }
    all.unshift(plan);
    if (!persist(all)) {
      return { ok: false, error: "Could not save locally. Storage may be full or unavailable." };
    }
    return { ok: true, plan: plan };
  }

  function update(id, patch) {
    var all = listRaw();
    var idx = -1;
    var i;
    for (i = 0; i < all.length; i++) if (all[i].id === id) { idx = i; break; }
    if (idx < 0) return { ok: false, error: "Hunt Plan not found." };
    var merged = Object.assign({}, all[idx], patch || {}, {
      id: id,
      createdAt: all[idx].createdAt
    });
    if (patch && Object.prototype.hasOwnProperty.call(patch, "scoutSpotIds")) {
      merged.scoutSpotIds = patch.scoutSpotIds;
    }
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
    return { ok: true, plan: next };
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

  function setOrder(id, scoutSpotIds) {
    var ids = normalizeSpotIds(scoutSpotIds);
    var plan = getById(id);
    if (!plan) return { ok: false, error: "Hunt Plan not found." };
    if (!ids.length && plan.scoutSpotIds.length) {
      return { ok: false, error: "A Hunt Plan needs at least one Scout Spot." };
    }
    return update(id, { scoutSpotIds: ids });
  }

  function moveSpot(id, scoutSpotId, dir) {
    var plan = getById(id);
    if (!plan) return { ok: false, error: "Hunt Plan not found." };
    var ids = plan.scoutSpotIds.slice();
    var idx = ids.indexOf(scoutSpotId);
    if (idx < 0) return { ok: false, error: "That Scout Spot is not in this Hunt Plan." };
    var next = idx + (dir < 0 ? -1 : 1);
    if (next < 0 || next >= ids.length) return { ok: true, plan: plan };
    var tmp = ids[idx];
    ids[idx] = ids[next];
    ids[next] = tmp;
    return update(id, { scoutSpotIds: ids });
  }

  function addSpot(planId, scoutSpotId) {
    var plan = getById(planId);
    if (!plan) return { ok: false, error: "Hunt Plan not found." };
    var sid = scoutSpotId != null ? String(scoutSpotId).trim() : "";
    if (!sid) return { ok: false, error: "Scout Spot required." };
    if (plan.scoutSpotIds.indexOf(sid) >= 0) {
      return { ok: false, error: "That Scout Spot is already in this Hunt Plan.", plan: plan };
    }
    if (plan.scoutSpotIds.length >= MAX_SPOTS_PER_PLAN) {
      return {
        ok: false,
        error: "This Hunt Plan already has " + MAX_SPOTS_PER_PLAN + " Scout Spots."
      };
    }
    return update(planId, { scoutSpotIds: plan.scoutSpotIds.concat([sid]) });
  }

  function removeSpot(planId, scoutSpotId) {
    var plan = getById(planId);
    if (!plan) return { ok: false, error: "Hunt Plan not found." };
    var ids = plan.scoutSpotIds.filter(function (id) { return id !== scoutSpotId; });
    return update(planId, { scoutSpotIds: ids });
  }

  function removeSpotFromAll(scoutSpotId) {
    var all = listRaw();
    var changed = false;
    var i;
    for (i = 0; i < all.length; i++) {
      var nextIds = all[i].scoutSpotIds.filter(function (id) { return id !== scoutSpotId; });
      if (nextIds.length !== all[i].scoutSpotIds.length) {
        all[i] = normalize(Object.assign({}, all[i], {
          scoutSpotIds: nextIds,
          updatedAt: new Date().toISOString()
        }));
        changed = true;
      }
    }
    if (!changed) return { ok: true, changed: false };
    if (!persist(all)) return { ok: false, error: "Could not update Hunt Plans." };
    return { ok: true, changed: true };
  }

  function remove(id) {
    var all = listRaw().filter(function (p) { return p.id !== id; });
    if (!persist(all)) {
      return { ok: false, error: "Could not update storage." };
    }
    return { ok: true, deletedId: id };
  }

  function toRad(d) {
    return d * Math.PI / 180;
  }

  function straightLineMeters(a, b) {
    if (!a || !b) return null;
    var lat1 = Number(a.lat);
    var lng1 = Number(a.lng);
    var lat2 = Number(b.lat);
    var lng2 = Number(b.lng);
    if (!isFinite(lat1) || !isFinite(lng1) || !isFinite(lat2) || !isFinite(lng2)) return null;
    var R = 6371000;
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var s1 = Math.sin(dLat / 2);
    var s2 = Math.sin(dLng / 2);
    var h = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function formatMeters(m) {
    if (m == null || !isFinite(m)) return null;
    if (m < 1000) return Math.round(m) + " m";
    return (Math.round(m / 100) / 10) + " km";
  }

  function sequenceDistance(locations) {
    var pts = Array.isArray(locations) ? locations.filter(function (p) {
      return p && isFinite(Number(p.lat)) && isFinite(Number(p.lng));
    }) : [];
    var legs = [];
    var total = 0;
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var m = straightLineMeters(pts[i], pts[i + 1]);
      if (m == null) continue;
      total += m;
      legs.push({ fromIndex: i, toIndex: i + 1, meters: m, label: formatMeters(m) });
    }
    return {
      label: "Straight-line distance",
      sequenceLabel: "Approx. straight-line sequence",
      totalMeters: pts.length >= 2 ? total : null,
      totalLabel: pts.length >= 2 ? formatMeters(total) : null,
      legs: legs,
      pointCount: pts.length
    };
  }

  function planLocation(plan, scoutStore) {
    if (!plan || !scoutStore || typeof scoutStore.getById !== "function") return null;
    var lats = [];
    var lngs = [];
    (plan.scoutSpotIds || []).forEach(function (id) {
      var spot = scoutStore.getById(id);
      if (!spot || !spot.location) return;
      if (!isFinite(spot.location.lat) || !isFinite(spot.location.lng)) return;
      lats.push(spot.location.lat);
      lngs.push(spot.location.lng);
    });
    if (!lats.length) return null;
    var lat = lats.reduce(function (s, v) { return s + v; }, 0) / lats.length;
    var lng = lngs.reduce(function (s, v) { return s + v; }, 0) / lngs.length;
    return {
      lat: lat,
      lng: lng,
      source: "hunt-plan-centroid",
      disclaimer: "Average of this plan’s Scout Spot coordinates — not conditions at every point."
    };
  }

  function resolveEntries(plan, scoutStore) {
    var ids = (plan && plan.scoutSpotIds) || [];
    return ids.map(function (id, index) {
      var spot = scoutStore && scoutStore.getById ? scoutStore.getById(id) : null;
      return {
        id: id,
        index: index,
        order: index + 1,
        missing: !spot,
        spot: spot || null,
        name: spot ? spot.name : "Scout Spot unavailable",
        status: spot ? spot.status : null,
        searchPriority: spot && spot.terrain && spot.terrain.available ? spot.terrain.searchPriority : null,
        featureLabel: spot && spot.terrain ? spot.terrain.featureLabel : null
      };
    });
  }

  function exportJson() {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      privacy: "private-local",
      huntPlans: listRaw()
    };
  }

  function importList(records) {
    var incoming = Array.isArray(records) ? records : [];
    var byId = {};
    listRaw().forEach(function (p) {
      if (p && p.id) byId[p.id] = p;
    });
    var added = 0;
    var replaced = 0;
    var skipped = 0;
    var count = Object.keys(byId).length;
    incoming.forEach(function (raw) {
      var plan = normalize(raw);
      if (!plan || !plan.id) {
        skipped += 1;
        return;
      }
      if (byId[plan.id]) {
        var prev = byId[plan.id];
        plan.createdAt = prev.createdAt;
        byId[plan.id] = plan;
        replaced += 1;
        return;
      }
      if (count >= MAX_PLANS) {
        skipped += 1;
        return;
      }
      byId[plan.id] = plan;
      added += 1;
      count += 1;
    });
    var merged = [];
    Object.keys(byId).forEach(function (id) { merged.push(byId[id]); });
    if (!persist(merged)) {
      return {
        ok: false,
        error: "Could not save imported Hunt Plans.",
        added: 0,
        replaced: 0,
        skipped: skipped,
        total: listRaw().length
      };
    }
    return { ok: true, added: added, replaced: replaced, skipped: skipped, total: listRaw().length };
  }

  global.WaypointShedsHuntPlans = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_PLANS: MAX_PLANS,
    MAX_SPOTS_PER_PLAN: MAX_SPOTS_PER_PLAN,
    STATUSES: STATUSES,
    FIELD_NOTE: FIELD_NOTE,
    normalize: normalize,
    defaultName: defaultName,
    list: list,
    getById: getById,
    create: create,
    update: update,
    rename: rename,
    setNote: setNote,
    setStatus: setStatus,
    setOrder: setOrder,
    moveSpot: moveSpot,
    addSpot: addSpot,
    removeSpot: removeSpot,
    removeSpotFromAll: removeSpotFromAll,
    remove: remove,
    straightLineMeters: straightLineMeters,
    sequenceDistance: sequenceDistance,
    formatMeters: formatMeters,
    planLocation: planLocation,
    resolveEntries: resolveEntries,
    exportJson: exportJson,
    importList: importList
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
