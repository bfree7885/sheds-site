/**
 * Sheds V1.6 — Field Hunt Session (local workflow state).
 *
 * A Hunt Session is the hunter working a Hunt Plan in the field.
 * It is not a Hunt Plan, not a Scout Spot, not a route, and not GPS check-in.
 *
 * Scout Spot records remain the source of truth for status and notes.
 * This store keeps only: which plan, which Scout Spot is current, startedAt.
 *
 * Schema: waypoint-sheds-hunt-session-v1
 * One active session per origin. Finish removes it.
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "waypoint-sheds-hunt-session-v1";
  var SCHEMA_VERSION = 1;
  var KIND = "hunt-session";
  var FIELD_NOTE =
    "Field Hunt Mode is working a Hunt Plan in the field — not navigation and not evidence that sheds are present.";

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function finiteLoc(loc) {
    if (!loc || typeof loc !== "object") return null;
    var lat = Number(loc.lat);
    var lng = Number(loc.lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    var huntPlanId = raw.huntPlanId != null ? String(raw.huntPlanId).trim().slice(0, 80) : "";
    if (!huntPlanId) return null;
    if (raw.kind != null && String(raw.kind) !== KIND) return null;
    var status = raw.status === "active" ? "active" : null;
    if (!status) return null;
    var active = raw.activeScoutSpotId != null ? String(raw.activeScoutSpotId).trim().slice(0, 80) : "";
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: KIND,
      sessionId: raw.sessionId && String(raw.sessionId).trim()
        ? String(raw.sessionId).trim().slice(0, 80)
        : ("hsess_" + uuid()),
      huntPlanId: huntPlanId,
      startedAt: raw.startedAt || nowIso(),
      updatedAt: raw.updatedAt || raw.startedAt || nowIso(),
      activeScoutSpotId: active || null,
      status: "active",
      privacy: "private-local",
      fieldNote: FIELD_NOTE
    };
  }

  function loadRaw() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && typeof data === "object" && data.session && typeof data.session === "object") {
        return normalize(data.session);
      }
      return normalize(data);
    } catch (e) {
      return null;
    }
  }

  function persist(session) {
    try {
      if (!session) {
        localStorage.removeItem(STORAGE_KEY);
        return true;
      }
      var next = normalize(session);
      if (!next) return false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        session: next
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function get() {
    return loadRaw();
  }

  function finish() {
    var prev = loadRaw();
    if (!persist(null)) {
      return { ok: false, error: "Could not update storage." };
    }
    return { ok: true, ended: true, sessionId: prev ? prev.sessionId : null };
  }

  function availableEntries(plan, scoutStore) {
    var HuntPlans = global.WaypointShedsHuntPlans;
    var resolved;
    if (HuntPlans && typeof HuntPlans.resolveEntries === "function") {
      resolved = HuntPlans.resolveEntries(plan, scoutStore);
    } else {
      var ids = (plan && plan.scoutSpotIds) || [];
      resolved = ids.map(function (id, index) {
        var spot = scoutStore && scoutStore.getById ? scoutStore.getById(id) : null;
        return {
          id: id,
          index: index,
          order: index + 1,
          missing: !spot,
          spot: spot || null,
          name: spot ? spot.name : "Scout Spot unavailable",
          status: spot ? spot.status : null
        };
      });
    }
    return resolved || [];
  }

  function availableIds(plan, scoutStore) {
    return availableEntries(plan, scoutStore).filter(function (e) {
      return e && !e.missing && e.id;
    }).map(function (e) { return e.id; });
  }

  function firstAvailableId(plan, scoutStore) {
    var ids = availableIds(plan, scoutStore);
    return ids.length ? ids[0] : null;
  }

  function healActiveId(session, plan, scoutStore) {
    if (!session) return null;
    var ids = availableIds(plan, scoutStore);
    if (!ids.length) {
      session.activeScoutSpotId = null;
      return session;
    }
    if (session.activeScoutSpotId && ids.indexOf(session.activeScoutSpotId) >= 0) {
      return session;
    }
    session.activeScoutSpotId = ids[0];
    return session;
  }

  function start(opts) {
    opts = opts || {};
    var HuntPlans = opts.huntPlans || global.WaypointShedsHuntPlans;
    var scoutStore = opts.scoutStore || global.WaypointShedsScoutSpots;
    var planId = opts.huntPlanId != null ? String(opts.huntPlanId).trim() : "";
    if (!planId) return { ok: false, error: "Hunt Plan required." };
    if (!HuntPlans || typeof HuntPlans.getById !== "function") {
      return { ok: false, error: "Hunt Plans unavailable." };
    }
    var plan = HuntPlans.getById(planId);
    if (!plan) return { ok: false, error: "Hunt Plan not found." };
    var ids = availableIds(plan, scoutStore);
    if (!ids.length) {
      return { ok: false, error: "This Hunt Plan has no available Scout Spots." };
    }
    var existing = loadRaw();
    if (existing && existing.huntPlanId === planId) {
      healActiveId(existing, plan, scoutStore);
      existing.updatedAt = nowIso();
      if (!persist(existing)) {
        return { ok: false, error: "Could not save locally. Storage may be full or unavailable." };
      }
      return { ok: true, session: get(), restored: true, planUnchanged: true };
    }
    var session = normalize({
      sessionId: "hsess_" + uuid(),
      huntPlanId: planId,
      startedAt: nowIso(),
      updatedAt: nowIso(),
      activeScoutSpotId: ids[0],
      status: "active"
    });
    if (!persist(session)) {
      return { ok: false, error: "Could not save locally. Storage may be full or unavailable." };
    }
    return { ok: true, session: get(), restored: false, planUnchanged: true };
  }

  function resume(opts) {
    opts = opts || {};
    var HuntPlans = opts.huntPlans || global.WaypointShedsHuntPlans;
    var scoutStore = opts.scoutStore || global.WaypointShedsScoutSpots;
    var session = loadRaw();
    if (!session) return { ok: true, session: null, restored: false };
    if (!HuntPlans || typeof HuntPlans.getById !== "function") {
      persist(null);
      return {
        ok: false,
        ended: true,
        error: "Hunt Plans unavailable. The Hunt Session was ended."
      };
    }
    var plan = HuntPlans.getById(session.huntPlanId);
    if (!plan) {
      persist(null);
      return {
        ok: false,
        ended: true,
        error: "That Hunt Plan is no longer on this device. The Hunt Session was ended."
      };
    }
    var before = session.activeScoutSpotId;
    healActiveId(session, plan, scoutStore);
    session.updatedAt = nowIso();
    if (!persist(session)) {
      return { ok: false, error: "Could not save locally. Storage may be full or unavailable." };
    }
    return {
      ok: true,
      session: get(),
      restored: true,
      activeSpotHealed: before !== (get() && get().activeScoutSpotId)
    };
  }

  function setActiveSpot(spotId, opts) {
    opts = opts || {};
    var HuntPlans = opts.huntPlans || global.WaypointShedsHuntPlans;
    var scoutStore = opts.scoutStore || global.WaypointShedsScoutSpots;
    var session = loadRaw();
    if (!session) return { ok: false, error: "No Hunt Session is in progress." };
    var plan = HuntPlans && HuntPlans.getById ? HuntPlans.getById(session.huntPlanId) : null;
    if (!plan) {
      persist(null);
      return {
        ok: false,
        ended: true,
        error: "That Hunt Plan is no longer on this device. The Hunt Session was ended."
      };
    }
    var sid = spotId != null ? String(spotId).trim() : "";
    if (!sid) return { ok: false, error: "Scout Spot required." };
    var ids = availableIds(plan, scoutStore);
    if (ids.indexOf(sid) < 0) {
      var listed = (plan.scoutSpotIds || []).indexOf(sid) >= 0;
      if (listed) {
        return { ok: false, error: "Scout Spot unavailable — this id is no longer on this device." };
      }
      return { ok: false, error: "That Scout Spot is not in this Hunt Plan." };
    }
    session.activeScoutSpotId = sid;
    session.updatedAt = nowIso();
    if (!persist(session)) {
      return { ok: false, error: "Could not save locally. Storage may be full or unavailable." };
    }
    return { ok: true, session: get() };
  }

  function stepActive(dir, opts) {
    opts = opts || {};
    var HuntPlans = opts.huntPlans || global.WaypointShedsHuntPlans;
    var scoutStore = opts.scoutStore || global.WaypointShedsScoutSpots;
    var session = loadRaw();
    if (!session) return { ok: false, error: "No Hunt Session is in progress." };
    var plan = HuntPlans && HuntPlans.getById ? HuntPlans.getById(session.huntPlanId) : null;
    if (!plan) {
      persist(null);
      return {
        ok: false,
        ended: true,
        error: "That Hunt Plan is no longer on this device. The Hunt Session was ended."
      };
    }
    var ids = availableIds(plan, scoutStore);
    if (!ids.length) {
      session.activeScoutSpotId = null;
      session.updatedAt = nowIso();
      persist(session);
      return { ok: true, session: get(), empty: true };
    }
    var idx = ids.indexOf(session.activeScoutSpotId);
    if (idx < 0) idx = 0;
    var next = idx + (dir < 0 ? -1 : 1);
    if (next < 0) next = 0;
    if (next >= ids.length) next = ids.length - 1;
    session.activeScoutSpotId = ids[next];
    session.updatedAt = nowIso();
    if (!persist(session)) {
      return { ok: false, error: "Could not save locally. Storage may be full or unavailable." };
    }
    return { ok: true, session: get(), index: next, total: ids.length };
  }

  function progress(plan, scoutStore) {
    var entries = availableEntries(plan, scoutStore);
    var available = entries.filter(function (e) { return e && !e.missing; });
    var checked = available.filter(function (e) { return e.status === "Checked"; });
    var missing = entries.filter(function (e) { return e && e.missing; }).length;
    var total = available.length;
    var n = checked.length;
    var label;
    if (!entries.length) {
      label = "No Scout Spots remain in this Hunt Plan.";
    } else if (!total) {
      label = "Scout Spots from this plan are unavailable on this device.";
    } else {
      label = n + " of " + total + " Scout Spots checked";
    }
    return {
      checked: n,
      total: total,
      missing: missing,
      label: label
    };
  }

  function distanceToActive(userLoc, opts) {
    opts = opts || {};
    var HuntPlans = opts.huntPlans || global.WaypointShedsHuntPlans;
    var scoutStore = opts.scoutStore || global.WaypointShedsScoutSpots;
    var session = opts.session || loadRaw();
    if (!session || !session.activeScoutSpotId) {
      return { available: false, reason: "no_active_spot", label: "Straight-line distance needs an active Scout Spot." };
    }
    var here = finiteLoc(userLoc);
    if (!here) {
      return {
        available: false,
        reason: "location_unavailable",
        label: "Location unavailable",
        detail: "Straight-line distance needs your current location. Field Hunt Mode still works."
      };
    }
    var spot = scoutStore && scoutStore.getById ? scoutStore.getById(session.activeScoutSpotId) : null;
    var there = spot ? finiteLoc(spot.location) : null;
    if (!there) {
      return {
        available: false,
        reason: "spot_location_unavailable",
        label: "Straight-line distance unavailable",
        detail: "This Scout Spot has no usable coordinates."
      };
    }
    var meters = HuntPlans && typeof HuntPlans.straightLineMeters === "function"
      ? HuntPlans.straightLineMeters(here, there)
      : null;
    if (meters == null || !isFinite(meters)) {
      return { available: false, reason: "not_finite", label: "Straight-line distance unavailable." };
    }
    var formatted = HuntPlans && typeof HuntPlans.formatMeters === "function"
      ? HuntPlans.formatMeters(meters)
      : (Math.round(meters) + " m");
    return {
      available: true,
      meters: meters,
      formatted: formatted,
      label: "Straight-line distance",
      display: "Straight-line distance: " + formatted
    };
  }

  function appendScoutNote(spotId, text, opts) {
    opts = opts || {};
    var scoutStore = opts.scoutStore || global.WaypointShedsScoutSpots;
    if (!scoutStore || typeof scoutStore.getById !== "function" || typeof scoutStore.setNote !== "function") {
      return { ok: false, error: "Scout Spots unavailable." };
    }
    var spot = scoutStore.getById(spotId);
    if (!spot) return { ok: false, error: "Scout Spot not found." };
    var add = String(text == null ? "" : text).replace(/^\s+|\s+$/g, "");
    if (!add) return { ok: false, error: "Note required." };
    var prev = spot.note ? String(spot.note) : "";
    var next = prev ? (prev + "\n" + add) : add;
    return scoutStore.setNote(spotId, next);
  }

  global.WaypointShedsHuntSession = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    KIND: KIND,
    FIELD_NOTE: FIELD_NOTE,
    normalize: normalize,
    get: get,
    persist: persist,
    start: start,
    resume: resume,
    finish: finish,
    setActiveSpot: setActiveSpot,
    nextSpot: function (opts) { return stepActive(1, opts); },
    previousSpot: function (opts) { return stepActive(-1, opts); },
    availableEntries: availableEntries,
    availableIds: availableIds,
    firstAvailableId: firstAvailableId,
    progress: progress,
    distanceToActive: distanceToActive,
    appendScoutNote: appendScoutNote,
    finiteLoc: finiteLoc
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
