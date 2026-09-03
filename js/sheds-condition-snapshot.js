/**
 * Sheds V1.9 — Condition Snapshot model (facts first).
 *
 * A Condition Snapshot is a compact environmental/context record for a real
 * location and time. It is not a search-priority score, not a heat map, and
 * not a shed/deer prediction.
 *
 * Layers (keep separate):
 *   facts     — measured or provider-returned values (or explicit unavailable)
 *   derived   — documented classifications from those facts (freeze/thaw, snow class)
 *   season    — calendar + existing Sheds timing heuristic (labeled as such)
 *   terrain   — optional elevation/slope/aspect already on hand; never invented
 *
 * Hunt Records store at most one snapshot captured around hunt start.
 * Legacy V1.7/V1.8 records omit this field entirely.
 */
(function (global) {
  "use strict";

  var SCHEMA_VERSION = 1;
  var KIND = "condition-snapshot";
  var PRIVACY = "private-local";
  var DATA_CLASS = "sheds-derived-facts";
  var CAPTURE_CONTEXTS = {
    "hunt-start": 1,
    "on-demand": 1
  };
  var ACQUISITION_STATUS = {
    ok: 1,
    unavailable: 1,
    offline: 1,
    timeout: 1,
    malformed: 1,
    "invalid-coordinate": 1,
    "no-location": 1
  };

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function finiteNum(n) {
    return typeof n === "number" && isFinite(n);
  }

  function finiteCoord(lat, lng) {
    var la = Number(lat);
    var ln = Number(lng);
    if (!isFinite(la) || !isFinite(ln)) return null;
    if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
    return { lat: la, lng: ln };
  }

  function clipStr(v, max) {
    if (v == null) return null;
    var s = String(v).replace(/^\s+|\s+$/g, "");
    if (!s) return null;
    return s.slice(0, max || 160);
  }

  function optNum(v, min, max) {
    if (v == null || v === "") return null;
    var n = Number(v);
    if (!finiteNum(n)) return null;
    if (min != null && n < min) return null;
    if (max != null && n > max) return null;
    return n;
  }

  function nowIso(d) {
    var date = d instanceof Date ? d : (d ? new Date(d) : new Date());
    if (isNaN(date.getTime())) date = new Date();
    return date.toISOString();
  }

  function dayOfYear(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    var start = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000) + 1;
  }

  function localCalendar(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return { localDate: null, month: null, dayOfYear: null };
    var y = d.getFullYear();
    var mo = d.getMonth() + 1;
    var day = d.getDate();
    return {
      localDate: y + "-" + String(mo).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
      month: mo,
      dayOfYear: dayOfYear(d)
    };
  }

  function emptyFacts() {
    return {
      airTemperatureC: null,
      recentMinTemperatureC: null,
      recentMaxTemperatureC: null,
      precipitationMm24h: null,
      precipitationNowMm: null,
      snowfallSumCm: null,
      snowDepthM: null,
      snowDepthKnown: false,
      windSpeedMs: null,
      temperatureTrendStatus: null,
      temperatureTrendDeltaC: null,
      temperatureTrendLookbackHours: null
    };
  }

  function emptyDerived() {
    return {
      freezeThaw: {
        classification: "insufficient",
        freezeThawOccurred: false,
        nightMinC: null,
        dayMaxC: null,
        deadbandC: 1,
        evidenceSource: null,
        ruleId: "overnight-min-daytime-max-deadband-1C"
      },
      snowCover: {
        status: "unavailable",
        depthM: null,
        ruleId: "measured-snow-depth-only"
      }
    };
  }

  function emptySeason(validAt) {
    var cal = localCalendar(validAt || new Date());
    return {
      localDate: cal.localDate,
      month: cal.month,
      dayOfYear: cal.dayOfYear,
      phaseId: "unknown",
      phaseLabel: "Season timing unclear",
      phaseRule: "WaypointShedsTiming.evaluate — regional photoperiod heuristic, not a cast date."
    };
  }

  function emptyTerrain() {
    return {
      elevationM: null,
      elevationStatus: "unavailable",
      slopeDeg: null,
      aspectDeg: null,
      note: "Hunt snapshots do not copy Search Areas grids. Elevation is stored only when already on the device (GPS altitude)."
    };
  }

  function unavailableSnapshot(opts) {
    opts = opts || {};
    var loc = opts.lat != null || opts.lng != null ? finiteCoord(opts.lat, opts.lng) : null;
    if (!loc && opts.location) loc = finiteCoord(opts.location.lat, opts.location.lng);
    var status = ACQUISITION_STATUS[opts.status] ? opts.status : "unavailable";
    var validAt = opts.validAt || opts.time || nowIso();
    return normalize({
      id: opts.id || ("csnap_" + uuid()),
      createdAt: opts.createdAt || nowIso(),
      validAt: validAt,
      captureContext: opts.captureContext || "hunt-start",
      location: loc,
      acquisition: {
        status: status,
        reason: clipStr(opts.reason, 160) || status,
        provider: null,
        fetchedAt: null
      },
      facts: emptyFacts(),
      derived: emptyDerived(),
      season: seasonFromTiming(loc, validAt),
      terrain: terrainFromOpts(opts.terrain)
    });
  }

  function seasonFromTiming(loc, validAt) {
    var season = emptySeason(validAt);
    var Timing = global.WaypointShedsTiming;
    if (!Timing || typeof Timing.evaluate !== "function") return season;
    try {
      var evald = Timing.evaluate({
        lat: loc && finiteNum(loc.lat) ? loc.lat : undefined,
        date: validAt ? new Date(validAt) : new Date()
      });
      if (!evald) return season;
      season.phaseId = clipStr(evald.phaseId || evald.category, 40) || season.phaseId;
      season.phaseLabel = clipStr(evald.plainLabel || evald.label, 80) || season.phaseLabel;
      season.phaseRule = "WaypointShedsTiming.evaluate via WaypointShedsBiological.seasonProfile — regional photoperiod window, not an individual cast date.";
      if (evald.season && evald.season.overridden) {
        season.phaseRule += " Phase was user-adjusted (preference, not established fact).";
      }
    } catch (e) { /* keep calendar facts */ }
    return season;
  }

  function terrainFromOpts(raw) {
    var t = emptyTerrain();
    if (!raw || typeof raw !== "object") return t;
    var elev = optNum(raw.elevationM, -500, 9000);
    if (elev != null) {
      t.elevationM = elev;
      t.elevationStatus = "recorded";
    }
    t.slopeDeg = optNum(raw.slopeDeg, 0, 90);
    t.aspectDeg = optNum(raw.aspectDeg, 0, 360);
    if (raw.note) t.note = clipStr(raw.note, 240) || t.note;
    return t;
  }

  function factsFromWeather(wx) {
    var facts = emptyFacts();
    if (!wx || typeof wx !== "object") return facts;
    facts.airTemperatureC = optNum(wx.tempC, -90, 60);
    facts.recentMinTemperatureC = optNum(wx.dailyMinC, -90, 60);
    facts.recentMaxTemperatureC = optNum(wx.dailyMaxC, -90, 60);
    facts.precipitationMm24h = optNum(wx.precipMm24h, 0, 2000);
    facts.precipitationNowMm = optNum(wx.precipNowMm, 0, 500);
    /* snowfallSumCm is Open-Meteo daily snowfall_sum (cm of snowfall). Never snow depth. */
    if (wx.snowfallSumCm != null) facts.snowfallSumCm = optNum(wx.snowfallSumCm, 0, 500);
    else if (typeof wx.snowMm === "number" && wx.snowfallKnown !== false && finiteNum(wx.snowMm)) {
      facts.snowfallSumCm = optNum(wx.snowMm, 0, 500);
    }
    facts.snowDepthKnown = !!wx.snowDepthKnown;
    facts.snowDepthM = facts.snowDepthKnown ? optNum(wx.snowDepthM, 0, 20) : null;
    if (!facts.snowDepthKnown) facts.snowDepthM = null;
    facts.windSpeedMs = optNum(wx.windSpeedMs, 0, 150);
    var trend = wx.tempTrend || {};
    facts.temperatureTrendStatus = clipStr(trend.status, 40);
    facts.temperatureTrendDeltaC = optNum(trend.deltaC, -80, 80);
    facts.temperatureTrendLookbackHours = optNum(trend.lookbackHours, 0, 96);
    return facts;
  }

  function derivedFromWeather(wx) {
    var derived = emptyDerived();
    if (!wx || typeof wx !== "object") return derived;
    var ft = wx.freezeThaw || {};
    var classification = clipStr(ft.status, 40) || "insufficient";
    derived.freezeThaw = {
      classification: classification,
      freezeThawOccurred: classification === "freeze_thaw",
      nightMinC: optNum(ft.nightMinC, -90, 60),
      dayMaxC: optNum(ft.dayMaxC, -90, 60),
      deadbandC: finiteNum(ft.deadbandC) ? ft.deadbandC : 1,
      evidenceSource: clipStr(ft.source, 40),
      ruleId: "overnight-min-daytime-max-deadband-1C"
    };
    var cover = wx.snowCover || {};
    derived.snowCover = {
      status: clipStr(cover.status, 40) || (wx.snowDepthKnown ? "unknown" : "unavailable"),
      depthM: wx.snowDepthKnown ? optNum(wx.snowDepthM, 0, 20) : null,
      ruleId: "measured-snow-depth-only"
    };
    return derived;
  }

  function fromWeatherPackage(opts) {
    opts = opts || {};
    var loc = finiteCoord(opts.lat, opts.lng);
    if (!loc && opts.location) loc = finiteCoord(opts.location.lat, opts.location.lng);
    var validAt = opts.validAt || opts.time || nowIso();
    var wx = opts.weather;
    var ready = !!(wx && wx.ready !== false && (
      wx.tempC != null ||
      wx.dailyMinC != null ||
      wx.dailyMaxC != null ||
      wx.snowDepthKnown === true ||
      wx.snowfallSumCm != null ||
      wx.precipMm24h != null
    ));
    if (!loc) {
      return unavailableSnapshot({
        status: "no-location",
        reason: "No valid coordinates — conditions were not invented.",
        captureContext: opts.captureContext,
        validAt: validAt,
        terrain: opts.terrain
      });
    }
    if (!ready) {
      var snap = unavailableSnapshot({
        lat: loc.lat,
        lng: loc.lng,
        status: opts.status || "unavailable",
        reason: opts.reason || (wx && wx.reason) || "Weather package was not ready.",
        captureContext: opts.captureContext,
        validAt: validAt,
        terrain: opts.terrain
      });
      snap.season = seasonFromTiming(loc, validAt);
      return snap;
    }
    return normalize({
      id: opts.id,
      createdAt: opts.createdAt,
      validAt: validAt,
      captureContext: opts.captureContext || "hunt-start",
      location: loc,
      acquisition: {
        status: "ok",
        reason: null,
        provider: "open-meteo",
        fetchedAt: wx.fetchedAt || nowIso(),
        dataset: "forecast"
      },
      facts: factsFromWeather(wx),
      derived: derivedFromWeather(wx),
      season: seasonFromTiming(loc, validAt),
      terrain: terrainFromOpts(opts.terrain)
    });
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.kind != null && String(raw.kind) !== KIND) return null;
    var loc = null;
    if (raw.location && typeof raw.location === "object") {
      loc = finiteCoord(raw.location.lat, raw.location.lng);
    } else if (raw.lat != null || raw.lng != null) {
      loc = finiteCoord(raw.lat, raw.lng);
    }
    var acq = raw.acquisition && typeof raw.acquisition === "object" ? raw.acquisition : {};
    var status = ACQUISITION_STATUS[acq.status] ? acq.status : (loc ? "unavailable" : "no-location");
    var ctx = CAPTURE_CONTEXTS[raw.captureContext] ? raw.captureContext : "hunt-start";
    var factsIn = raw.facts && typeof raw.facts === "object" ? raw.facts : {};
    var derivedIn = raw.derived && typeof raw.derived === "object" ? raw.derived : {};
    var ftIn = derivedIn.freezeThaw && typeof derivedIn.freezeThaw === "object" ? derivedIn.freezeThaw : {};
    var snowIn = derivedIn.snowCover && typeof derivedIn.snowCover === "object" ? derivedIn.snowCover : {};
    var seasonIn = raw.season && typeof raw.season === "object" ? raw.season : {};
    var cal = localCalendar(raw.validAt || raw.createdAt || new Date());
    var facts = emptyFacts();
    facts.airTemperatureC = optNum(factsIn.airTemperatureC, -90, 60);
    facts.recentMinTemperatureC = optNum(factsIn.recentMinTemperatureC, -90, 60);
    facts.recentMaxTemperatureC = optNum(factsIn.recentMaxTemperatureC, -90, 60);
    facts.precipitationMm24h = optNum(factsIn.precipitationMm24h, 0, 2000);
    facts.precipitationNowMm = optNum(factsIn.precipitationNowMm, 0, 500);
    facts.snowfallSumCm = optNum(factsIn.snowfallSumCm, 0, 500);
    facts.snowDepthKnown = !!factsIn.snowDepthKnown;
    facts.snowDepthM = facts.snowDepthKnown ? optNum(factsIn.snowDepthM, 0, 20) : null;
    facts.windSpeedMs = optNum(factsIn.windSpeedMs, 0, 150);
    facts.temperatureTrendStatus = clipStr(factsIn.temperatureTrendStatus, 40);
    facts.temperatureTrendDeltaC = optNum(factsIn.temperatureTrendDeltaC, -80, 80);
    facts.temperatureTrendLookbackHours = optNum(factsIn.temperatureTrendLookbackHours, 0, 96);

    var freezeClass = clipStr(ftIn.classification, 40) || "insufficient";
    var derived = {
      freezeThaw: {
        classification: freezeClass,
        freezeThawOccurred: ftIn.freezeThawOccurred != null
          ? !!ftIn.freezeThawOccurred
          : freezeClass === "freeze_thaw",
        nightMinC: optNum(ftIn.nightMinC, -90, 60),
        dayMaxC: optNum(ftIn.dayMaxC, -90, 60),
        deadbandC: finiteNum(ftIn.deadbandC) ? ftIn.deadbandC : 1,
        evidenceSource: clipStr(ftIn.evidenceSource, 40),
        ruleId: clipStr(ftIn.ruleId, 80) || "overnight-min-daytime-max-deadband-1C"
      },
      snowCover: {
        status: clipStr(snowIn.status, 40) || (facts.snowDepthKnown ? "unknown" : "unavailable"),
        depthM: facts.snowDepthKnown ? facts.snowDepthM : null,
        ruleId: clipStr(snowIn.ruleId, 80) || "measured-snow-depth-only"
      }
    };

    return {
      schemaVersion: SCHEMA_VERSION,
      kind: KIND,
      id: raw.id && String(raw.id).trim() ? String(raw.id).trim().slice(0, 80) : ("csnap_" + uuid()),
      createdAt: raw.createdAt || nowIso(),
      validAt: raw.validAt || raw.createdAt || nowIso(),
      captureContext: ctx,
      dataClass: DATA_CLASS,
      privacy: PRIVACY,
      location: loc ? { lat: loc.lat, lng: loc.lng } : null,
      acquisition: {
        status: status,
        reason: clipStr(acq.reason, 160),
        provider: clipStr(acq.provider, 40),
        fetchedAt: acq.fetchedAt || null,
        dataset: clipStr(acq.dataset, 40)
      },
      facts: facts,
      derived: derived,
      season: {
        localDate: clipStr(seasonIn.localDate, 12) || cal.localDate,
        month: optNum(seasonIn.month, 1, 12) != null ? optNum(seasonIn.month, 1, 12) : cal.month,
        dayOfYear: optNum(seasonIn.dayOfYear, 1, 366) != null ? optNum(seasonIn.dayOfYear, 1, 366) : cal.dayOfYear,
        phaseId: clipStr(seasonIn.phaseId, 40) || "unknown",
        phaseLabel: clipStr(seasonIn.phaseLabel, 80) || "Season timing unclear",
        phaseRule: clipStr(seasonIn.phaseRule, 240) ||
          "WaypointShedsTiming.evaluate — regional photoperiod heuristic, not a cast date."
      },
      terrain: terrainFromOpts(raw.terrain),
      provenance: {
        weather: "open-meteo-forecast",
        elevation: "device-gps-altitude-if-present",
        season: "sheds-timing"
      }
    };
  }

  function presence(rec) {
    if (!rec || typeof rec !== "object") return "legacy";
    if (!rec.conditionSnapshot) return "legacy";
    var snap = rec.conditionSnapshot;
    if (!snap || typeof snap !== "object") return "legacy";
    var status = snap.acquisition && snap.acquisition.status;
    var facts = snap.facts || {};
    var hasFact = facts.airTemperatureC != null || facts.recentMinTemperatureC != null ||
      facts.snowDepthKnown === true || facts.snowfallSumCm != null ||
      facts.precipitationMm24h != null;
    if (status === "ok" || hasFact) return "recorded";
    return "unavailable";
  }

  function formatTemp(c) {
    if (c == null || !finiteNum(c)) return "Unavailable";
    return (Math.round(c * 10) / 10) + " °C";
  }

  function formatSnowDepth(snap) {
    var facts = snap && snap.facts;
    if (!facts || !facts.snowDepthKnown || facts.snowDepthM == null) return "Unavailable";
    var m = facts.snowDepthM;
    if (m <= 0) return "0 cm (measured)";
    return (Math.round(m * 1000) / 10) + " cm (measured)";
  }

  function formatPrecip(snap) {
    var facts = snap && snap.facts;
    if (!facts) return "Unavailable";
    var bits = [];
    if (facts.precipitationMm24h != null) bits.push(Math.round(facts.precipitationMm24h * 10) / 10 + " mm recent precip");
    if (facts.snowfallSumCm != null) bits.push(Math.round(facts.snowfallSumCm * 10) / 10 + " cm snowfall (not depth)");
    return bits.length ? bits.join(" · ") : "Unavailable";
  }

  function formatFreeze(snap) {
    var ft = snap && snap.derived && snap.derived.freezeThaw;
    if (!ft || ft.classification === "insufficient") return "Unavailable";
    if (ft.freezeThawOccurred) return "Overnight freeze then thaw";
    if (ft.classification === "below_freezing") return "Staying below freezing";
    if (ft.classification === "above_freezing") return "Staying above freezing";
    if (ft.classification === "near_freezing") return "Near freezing";
    return "Unavailable";
  }

  function formatSeason(snap) {
    var s = snap && snap.season;
    if (!s) return "Unavailable";
    var label = s.phaseLabel || "Season timing unclear";
    if (s.localDate) return label + " · " + s.localDate;
    return label;
  }

  function detailRows(rec) {
    var kind = presence(rec);
    if (kind === "legacy") {
      return {
        kind: kind,
        heading: "Conditions at hunt time",
        note: "Conditions not recorded. This Hunt Record predates Condition Snapshots.",
        rows: []
      };
    }
    var snap = rec.conditionSnapshot;
    if (kind === "unavailable") {
      return {
        kind: kind,
        heading: "Conditions at hunt time",
        note: "Conditions unavailable during this hunt. The Hunt Record is still valid.",
        rows: [
          { dt: "Temperature", dd: "Unavailable" },
          { dt: "Snow depth", dd: "Unavailable" },
          { dt: "Freeze / thaw", dd: "Unavailable" },
          { dt: "Precipitation / snow", dd: "Unavailable" },
          { dt: "Season", dd: formatSeason(snap) }
        ]
      };
    }
    return {
      kind: kind,
      heading: "Conditions at hunt time",
      note: "Factual snapshot from hunt start. Not a search-priority score and not a prediction.",
      rows: [
        { dt: "Temperature", dd: formatTemp(snap.facts && snap.facts.airTemperatureC) },
        { dt: "Recent min / max", dd:
          (snap.facts && snap.facts.recentMinTemperatureC != null && snap.facts.recentMaxTemperatureC != null)
            ? formatTemp(snap.facts.recentMinTemperatureC) + " / " + formatTemp(snap.facts.recentMaxTemperatureC)
            : "Unavailable" },
        { dt: "Snow depth", dd: formatSnowDepth(snap) },
        { dt: "Freeze / thaw", dd: formatFreeze(snap) },
        { dt: "Precipitation / snow", dd: formatPrecip(snap) },
        { dt: "Season", dd: formatSeason(snap) }
      ]
    };
  }

  function estimateBytes(rec) {
    try {
      return JSON.stringify(rec || {}).length;
    } catch (e) {
      return 0;
    }
  }

  function typicalHuntRecordBytes(opts) {
    opts = opts || {};
    var trackN = opts.trackPoints != null ? opts.trackPoints : 1800;
    var obsN = opts.observations != null ? opts.observations : 80;
    var point = { lat: 41.32512, lng: -74.80245, t: 1700000000000, acc: 8 };
    var obs = {
      id: "hobs_typical",
      type: "deer_sign",
      label: "Deer Sign",
      createdAt: "2026-09-03T12:00:00.000Z",
      mapped: true,
      lat: 41.32512,
      lng: -74.80245,
      note: "Typical observation note for size estimate.",
      privacy: "private-local"
    };
    var snap = fromWeatherPackage({
      lat: 41.325,
      lng: -74.802,
      weather: {
        ready: true,
        tempC: -2.1,
        dailyMinC: -8.4,
        dailyMaxC: 1.2,
        precipMm24h: 1.5,
        precipNowMm: 0,
        snowfallSumCm: 0.4,
        snowDepthKnown: true,
        snowDepthM: 0.03,
        windSpeedMs: 3.2,
        fetchedAt: "2026-09-03T12:00:00.000Z",
        tempTrend: { status: "warming", deltaC: 2.4, lookbackHours: 48 },
        freezeThaw: {
          status: "freeze_thaw",
          nightMinC: -8.4,
          dayMaxC: 1.2,
          deadbandC: 1,
          source: "hourly"
        },
        snowCover: { status: "light", depthM: 0.03 }
      }
    });
    var rec = {
      schemaVersion: 1,
      kind: "hunt-record",
      huntRecordId: "hrec_size_estimate",
      huntPlanNameSnapshot: "Ridge North",
      startedAt: "2026-09-03T12:00:00.000Z",
      finishedAt: "2026-09-03T15:00:00.000Z",
      trackPoints: [],
      observations: [],
      conditionSnapshot: snap,
      privacy: "private-local"
    };
    var i;
    for (i = 0; i < trackN; i++) rec.trackPoints.push(point);
    for (i = 0; i < obsN; i++) rec.observations.push(obs);
    var bytes = estimateBytes(rec);
    return {
      bytes: bytes,
      snapshotBytes: estimateBytes(snap),
      maxRecords: 24,
      worstCaseBytes: bytes * 24,
      typicalQuotaBytes: 5 * 1024 * 1024
    };
  }

  global.WaypointShedsConditionSnapshot = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    KIND: KIND,
    PRIVACY: PRIVACY,
    DATA_CLASS: DATA_CLASS,
    finiteCoord: finiteCoord,
    normalize: normalize,
    unavailable: unavailableSnapshot,
    fromWeatherPackage: fromWeatherPackage,
    presence: presence,
    detailRows: detailRows,
    formatTemp: formatTemp,
    formatSnowDepth: formatSnowDepth,
    formatFreeze: formatFreeze,
    estimateBytes: estimateBytes,
    typicalHuntRecordBytes: typicalHuntRecordBytes
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
