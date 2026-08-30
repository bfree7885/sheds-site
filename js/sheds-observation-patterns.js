/**
 * Sheds — observation pattern aggregation + observation-only heat grid.
 * Heat is derived ONLY from the user's private observations (no demo/seed data).
 * Labels: Observed activity · Pattern derived from observations · Estimated opportunity.
 */
(function (global) {
  "use strict";

  /** Minimum wildlife/sign observations before patterns inform Today's Search. */
  var MIN_PATTERN_OBS = 5;
  /** Minimum distinct days before calling patterns "sufficient". */
  var MIN_PATTERN_DAYS = 2;

  var ACTIVITY_TYPES = {
    deer_seen: { weight: 1.0, group: "wildlife" },
    deer_sign: { weight: 0.75, group: "sign" },
    bedding_area: { weight: 0.9, group: "habitat" },
    feeding_area: { weight: 0.85, group: "habitat" },
    trail_crossing: { weight: 0.8, group: "travel" },
    fence_crossing: { weight: 0.8, group: "travel" },
    winter_concentration: { weight: 0.95, group: "habitat" },
    shed_found: { weight: 1.05, group: "find" },
    habitat_note: { weight: 0.35, group: "habitat" }
  };

  var HABITAT_LABELS = {
    hardwoods: "Hardwoods",
    conifer: "Conifer / thermal",
    edge: "Edge / transition",
    field: "Field / food plot",
    wetland: "Wetland / creek",
    ridge: "Ridge / south slope",
    other: "Other habitat"
  };

  function parseWhen(obs) {
    var t = Date.parse(obs && (obs.observedAt || obs.createdAt) || "");
    return isFinite(t) ? t : null;
  }

  function timeOfDayBucket(ms) {
    if (ms == null) return "unknown";
    var d = new Date(ms);
    var h = d.getHours() + d.getMinutes() / 60;
    if (h < 10) return "morning";
    if (h < 15) return "midday";
    return "evening";
  }

  function seasonBucket(ms) {
    if (ms == null) return "unknown";
    var m = new Date(ms).getMonth() + 1;
    if (m === 12 || m <= 2) return "winter";
    if (m <= 4) return "late_winter_spring";
    if (m <= 8) return "summer";
    return "fall";
  }

  function dayKey(ms) {
    if (ms == null) return null;
    var d = new Date(ms);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function isActivity(obs) {
    return !!(obs && ACTIVITY_TYPES[obs.type]);
  }

  function haversineM(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /**
   * @param {Array} observations
   * @param {object} filters
   * @param {string|null} filters.timeOfDay morning|midday|evening|all
   * @param {string|null} filters.season winter|late_winter_spring|summer|fall|all
   * @param {number|null} filters.sinceMs
   * @param {number|null} filters.untilMs
   * @param {string|null} filters.weather snowy|mild|windy|any
   * @param {string[]|null} filters.types
   */
  function filterObservations(observations, filters) {
    filters = filters || {};
    var list = (observations || []).filter(isActivity);
    var tod = filters.timeOfDay && filters.timeOfDay !== "all" ? filters.timeOfDay : null;
    var season = filters.season && filters.season !== "all" ? filters.season : null;
    var wx = filters.weather && filters.weather !== "any" ? filters.weather : null;
    var types = filters.types && filters.types.length ? filters.types : null;
    var since = typeof filters.sinceMs === "number" ? filters.sinceMs : null;
    var until = typeof filters.untilMs === "number" ? filters.untilMs : null;

    return list.filter(function (o) {
      var ms = parseWhen(o);
      if (tod && timeOfDayBucket(ms) !== tod) return false;
      if (season && seasonBucket(ms) !== season) return false;
      if (since != null && (ms == null || ms < since)) return false;
      if (until != null && (ms == null || ms > until)) return false;
      if (types && types.indexOf(o.type) < 0) return false;
      if (wx) {
        var snap = o.weatherSnapshot || (o.details && o.details.weatherSnapshot) || null;
        if (!snap) return false;
        if (wx === "snowy") {
          if (!(snap.snowMm > 0.5 || snap.tempC <= 0)) return false;
        } else if (wx === "mild") {
          if (!(typeof snap.tempC === "number" && snap.tempC >= 8)) return false;
        } else if (wx === "windy") {
          if (!(snap.windSpeedMs >= 6)) return false;
        }
      }
      return true;
    });
  }

  function aggregatePatterns(observations) {
    var activity = (observations || []).filter(isActivity);
    var byTod = { morning: 0, midday: 0, evening: 0, unknown: 0 };
    var byDow = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    var bySeason = {};
    var byHabitat = {};
    var days = Object.create(null);
    var i;

    for (i = 0; i < activity.length; i++) {
      var o = activity[i];
      var ms = parseWhen(o);
      var tod = timeOfDayBucket(ms);
      byTod[tod] = (byTod[tod] || 0) + 1;
      if (ms != null) {
        byDow[new Date(ms).getDay()] += 1;
        var sk = seasonBucket(ms);
        bySeason[sk] = (bySeason[sk] || 0) + 1;
        var dk = dayKey(ms);
        if (dk) days[dk] = 1;
      }
      var hab = o.details && o.details.habitat;
      if (hab) byHabitat[hab] = (byHabitat[hab] || 0) + 1;
    }

    var dayCount = Object.keys(days).length;
    var sufficient = activity.length >= MIN_PATTERN_OBS && dayCount >= MIN_PATTERN_DAYS;

    function topEntries(map, labelFn, n) {
      return Object.keys(map).map(function (k) {
        return { id: k, label: labelFn ? labelFn(k) : k, count: map[k] };
      }).filter(function (x) {
        return x.id !== "unknown" && x.count > 0;
      }).sort(function (a, b) {
        return b.count - a.count;
      }).slice(0, n || 3);
    }

    var dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var topTod = topEntries(byTod, function (k) {
      return k.charAt(0).toUpperCase() + k.slice(1);
    }, 3);
    var topDow = topEntries(byDow, function (k) {
      return dowNames[Number(k)] || k;
    }, 3);
    var topHabitats = topEntries(byHabitat, function (k) {
      return HABITAT_LABELS[k] || k;
    }, 3);

    var summary = null;
    var insufficiencyReason =
      "Need at least " + MIN_PATTERN_OBS + " wildlife/sign observations across " +
      MIN_PATTERN_DAYS + " different days (have " + activity.length + " on " + dayCount +
      " day(s)). Patterns stay private on this device.";

    if (sufficient) {
      var bits = [];
      if (topTod[0]) bits.push("most notes in " + topTod[0].label.toLowerCase());
      if (topDow[0]) bits.push("often on " + topDow[0].label);
      if (topHabitats[0]) bits.push("habitat tag “" + topHabitats[0].label + "”");
      summary = "Pattern derived from " + activity.length + " private observations" +
        (bits.length ? " — " + bits.join("; ") : "") +
        ". This is observed activity history, not a prediction.";
    }

    return {
      schemaVersion: 1,
      kind: "pattern",
      label: "Pattern derived from observations",
      activityCount: activity.length,
      distinctDays: dayCount,
      sufficient: sufficient,
      minRequired: { observations: MIN_PATTERN_OBS, days: MIN_PATTERN_DAYS },
      insufficiencyReason: insufficiencyReason,
      summary: summary,
      byTimeOfDay: byTod,
      byDayOfWeek: byDow,
      bySeason: bySeason,
      topTimeOfDay: topTod,
      topDayOfWeek: topDow,
      topHabitats: topHabitats,
      disclaimer:
        "Patterns summarize your private notes only. They do not predict exact deer locations."
    };
  }

  function weightFor(obs, nowMs) {
    var meta = ACTIVITY_TYPES[obs.type] || { weight: 0.3 };
    var w = meta.weight;
    var ms = parseWhen(obs);
    if (ms != null && nowMs != null) {
      var ageDays = (nowMs - ms) / 86400000;
      if (ageDays < 0) ageDays = 0;
      // Recency soft decay — older notes still count, just less.
      w *= clamp(1.15 - ageDays / 180, 0.35, 1.15);
    }
    if (obs.confidence === "confirmed") w *= 1.1;
    else if (obs.confidence === "uncertain") w *= 0.85;
    if (typeof obs.quantity === "number" && obs.quantity > 1) {
      w *= clamp(1 + 0.08 * Math.min(obs.quantity, 5), 1, 1.4);
    }
    return w;
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  /**
   * Build a grid whose priority is ONLY from filtered observations (kernel influence).
   * Empty observations → empty cells with honest coverage.
   */
  function buildObservationHeatGrid(bounds, rows, cols, observations, filters, opts) {
    opts = opts || {};
    rows = rows || 16;
    cols = cols || 16;
    var nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
    var filtered = filterObservations(observations, filters);
    var west = bounds.getWest();
    var east = bounds.getEast();
    var south = bounds.getSouth();
    var north = bounds.getNorth();
    var cellH = (north - south) / rows;
    var cellW = (east - west) / cols;
    var midLat = (north + south) / 2;
    var cellMeters = haversineM(midLat, west, midLat, west + cellW);
    var radiusM = Math.max(80, Math.min(420, cellMeters * 2.4));

    var cells = [];
    var maxRaw = 0;
    var r, c;

    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var lat = north - (r + 0.5) * cellH;
        var lng = west + (c + 0.5) * cellW;
        var raw = 0;
        var near = [];
        for (var i = 0; i < filtered.length; i++) {
          var o = filtered[i];
          var d = haversineM(lat, lng, o.location.lat, o.location.lng);
          if (d > radiusM * 1.6) continue;
          var fall = Math.exp(-((d * d) / (2 * radiusM * radiusM)));
          var contrib = weightFor(o, nowMs) * fall;
          raw += contrib;
          if (fall > 0.15) {
            near.push({ id: o.id, type: o.type, distanceM: Math.round(d) });
          }
        }
        if (raw > maxRaw) maxRaw = raw;
        cells.push({
          row: r,
          col: c,
          lat: lat,
          lng: lng,
          raw: raw,
          nearbyObservations: near.slice(0, 6)
        });
      }
    }

    var scored = cells.map(function (cell) {
      var priority = maxRaw > 0 ? clamp(cell.raw / maxRaw, 0, 1) : 0;
      // Soften empty map so heat does not invent activity
      if (filtered.length === 0) priority = 0;
      var band = priority >= 0.72 ? "higher" : priority >= 0.4 ? "moderate" : priority > 0 ? "lower" : "none";
      return {
        row: cell.row,
        col: cell.col,
        lat: cell.lat,
        lng: cell.lng,
        priority: Math.round(priority * 1000) / 1000,
        band: band,
        coverageLevel: null,
        result: {
          explanation:
            filtered.length === 0
              ? "No matching private observations in this filter — heat stays empty (honest empty state)."
              : cell.raw > 0
                ? "Observed activity influence from your private notes near this cell. Not a prediction of current deer presence."
                : "No nearby matching observations for this cell.",
          parts: { observationHeat: cell.raw },
          sources: { observations: filtered.length ? "user-observation" : "unavailable" },
          nearbyObservations: cell.nearbyObservations,
          inputMode: "local-observations-only",
          epistemic: "observed",
          label: "Observed activity"
        }
      };
    });

    var coverageLevel = filtered.length === 0 ? "limited"
      : filtered.length < MIN_PATTERN_OBS ? "moderate" : "strong";

    return {
      cells: scored,
      bounds: { west: west, east: east, south: south, north: north },
      rows: rows,
      cols: cols,
      cellMetersApprox: Math.round(cellMeters),
      mode: "observed-activity",
      layerKind: "observed-activity",
      layerLabel: "Observed activity",
      epistemic: "observed",
      filterSummary: summarizeFilters(filters),
      observationCount: filtered.length,
      coverage: {
        level: coverageLevel,
        label: filtered.length === 0
          ? "No observations match these filters — empty observed-activity layer"
          : ("Observed activity from " + filtered.length + " private observation(s)")
      },
      disclaimer:
        "This layer shows where YOU recorded activity. It is not a live wildlife map and not a certainty of deer now."
    };
  }

  function summarizeFilters(filters) {
    filters = filters || {};
    var bits = [];
    if (filters.timeOfDay && filters.timeOfDay !== "all") bits.push(filters.timeOfDay);
    if (filters.season && filters.season !== "all") bits.push(filters.season);
    if (filters.weather && filters.weather !== "any") bits.push("weather:" + filters.weather);
    if (filters.sinceMs) bits.push("since " + new Date(filters.sinceMs).toISOString().slice(0, 10));
    if (filters.untilMs) bits.push("until " + new Date(filters.untilMs).toISOString().slice(0, 10));
    return bits.length ? bits.join(" · ") : "all activity types (unfiltered)";
  }

  function defaultHeatFilters() {
    return {
      timeOfDay: "all",
      season: "all",
      weather: "any",
      sinceMs: null,
      untilMs: null,
      types: null
    };
  }

  global.WaypointShedsObservationPatterns = {
    MIN_PATTERN_OBS: MIN_PATTERN_OBS,
    MIN_PATTERN_DAYS: MIN_PATTERN_DAYS,
    ACTIVITY_TYPES: ACTIVITY_TYPES,
    isActivity: isActivity,
    timeOfDayBucket: timeOfDayBucket,
    seasonBucket: seasonBucket,
    filterObservations: filterObservations,
    aggregatePatterns: aggregatePatterns,
    buildObservationHeatGrid: buildObservationHeatGrid,
    defaultHeatFilters: defaultHeatFilters,
    summarizeFilters: summarizeFilters,
    haversineM: haversineM
  };
})(typeof window !== "undefined" ? window : globalThis);
