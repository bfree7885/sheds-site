/**
 * Sheds V1.3 — Where should I look? (search-priority terrain intelligence)
 *
 * Conceptual layers (kept separate):
 *   RAW DATA            slope°, aspect, elevation
 *   DERIVED FEATURE     bench, transition, steep, ridge, drainage, undifferentiated
 *   INTERPRETATION      Higher / Moderate / Lower search priority + why
 *
 * Today’s Hunt (V1.2) is CONTEXT ONLY. It never rewrites base terrain priority
 * and must not imply timing is favorable when season is outside.
 *
 * Never claims: antlers present, deer present, a travel route, a find, or a %.
 */
(function (global) {
  "use strict";

  var VERSION = "1.3.0";
  var MIN_ZOOM = 12;
  var MIN_INSPECT_ZOOM = 11;
  var MAX_CELL_STEP_M = 450;
  var MAX_SPAN_M = 3000;
  var GRID_ROWS = 12;
  var GRID_COLS = 12;
  var HALO = 1;
  var ASPECT_MIN_SLOPE = 2;
  var GENTLE_MAX = 12;
  var STEEP_NEIGHBOR = 18;
  var STEEP_PENALTY = 22;
  var VERY_STEEP = 25;
  var DIFF_RANGE_MIN = 8;
  var FLAT_RANGE_MAX = 6;
  var RELIEF_M = 4;

  var PRIORITIES = Object.freeze(["Higher", "Moderate", "Lower"]);

  var ASPECT_DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  var ASPECT_FACING = {
    N: "north-facing",
    NE: "northeast-facing",
    E: "east-facing",
    SE: "southeast-facing",
    S: "south-facing",
    SW: "southwest-facing",
    W: "west-facing",
    NW: "northwest-facing"
  };

  var COPY = {
    UNAVAILABLE: "Terrain intelligence unavailable here",
    ZOOM: "Zoom in to inspect terrain",
    INCOMPLETE: "Not enough terrain data",
    FAILED: "Terrain intelligence unavailable here",
    LOADING: "Reading terrain…",
    FIELD_NOTE:
      "Use the terrain as a search guide, not evidence that sheds are present.",
    MISSING_NOT_MODERATE: "Missing terrain data is not a Moderate rating."
  };

  var BANNED = [
    "shed found",
    "antler here",
    "deer are here",
    "deer present",
    "deer travel",
    "travel route",
    "find probability",
    "shed probability",
    "chance of finding",
    "83%",
    "0.76",
    "ai confidence",
    "sheds are likely",
    "expect to find"
  ];

  function finiteNum(n) {
    return typeof n === "number" && isFinite(n);
  }

  function aspectCardinal(deg) {
    if (!finiteNum(deg)) return null;
    var ix = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
    return ASPECT_DIRS[ix];
  }

  function aspectFacingPhrase(cardinal) {
    if (!cardinal) return null;
    return ASPECT_FACING[cardinal] || null;
  }

  /**
   * Finite-difference slope/aspect from N/S/E/W elevations (meters).
   * Same convention as Inspect V3.2 / likelihood-model.
   */
  function slopeAspectFromElevNeighbors(opts) {
    opts = opts || {};
    var c = opts.centerM;
    var n = opts.northM;
    var s = opts.southM;
    var e = opts.eastM;
    var w = opts.westM;
    var stepM = opts.stepM != null ? opts.stepM : 60;
    if (
      !finiteNum(c) ||
      !finiteNum(n) ||
      !finiteNum(s) ||
      !finiteNum(e) ||
      !finiteNum(w) ||
      !(stepM > 0)
    ) {
      return { slopeDeg: null, aspectDeg: null, elevM: finiteNum(c) ? c : null, source: "unavailable" };
    }
    var dzdy = (s - n) / (2 * stepM);
    var dzdx = (e - w) / (2 * stepM);
    var slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
    var slopeDeg = slopeRad * (180 / Math.PI);
    var aspectDeg = ((Math.atan2(-dzdx, dzdy) * 180 / Math.PI) + 360) % 360;
    return {
      slopeDeg: Math.round(slopeDeg * 10) / 10,
      aspectDeg: Math.round(aspectDeg),
      elevM: c,
      source: "open-meteo-neighborhood"
    };
  }

  function directionalGradeDeg(centerM, neighborM, stepM) {
    if (!finiteNum(centerM) || !finiteNum(neighborM) || !(stepM > 0)) return null;
    return Math.atan(Math.abs(neighborM - centerM) / stepM) * (180 / Math.PI);
  }

  function formatElevFt(elevM) {
    if (!finiteNum(elevM)) return null;
    var ft = Math.round(elevM * 3.28084);
    var s = String(ft);
    if (s.length > 3) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return s + " ft";
  }

  function metersPerDegLng(lat) {
    return 111320 * Math.cos(((finiteNum(lat) ? lat : 40) * Math.PI) / 180);
  }

  function stepMetersFromBounds(bounds, haloRows, haloCols) {
    if (!bounds) return null;
    var dLat = Math.abs(bounds.north - bounds.south) / haloRows;
    var dLng = Math.abs(bounds.east - bounds.west) / haloCols;
    var midLat = (bounds.north + bounds.south) / 2;
    var ns = dLat * 111320;
    var ew = dLng * metersPerDegLng(midLat);
    return { ns: ns, ew: ew, mean: (ns + ew) / 2 };
  }

  /**
   * Keep overlay analysis on a local window so desktop viewports do not
   * produce kilometer-scale cells (which would look like fake heat).
   */
  function clampSearchBounds(bounds, maxSpanM) {
    if (!bounds) return bounds;
    maxSpanM = maxSpanM != null ? maxSpanM : MAX_SPAN_M;
    var lat = (Number(bounds.north) + Number(bounds.south)) / 2;
    var lng = (Number(bounds.east) + Number(bounds.west)) / 2;
    var spanLatM = Math.abs(bounds.north - bounds.south) * 111320;
    var spanLngM = Math.abs(bounds.east - bounds.west) * metersPerDegLng(lat);
    if (!(spanLatM > maxSpanM) && !(spanLngM > maxSpanM)) return bounds;
    var halfLat = (Math.min(spanLatM, maxSpanM) / 111320) / 2;
    var halfLng = (Math.min(spanLngM, maxSpanM) / metersPerDegLng(lat)) / 2;
    return {
      north: lat + halfLat,
      south: lat - halfLat,
      west: lng - halfLng,
      east: lng + halfLng
    };
  }

  function containsBannedLanguage(text) {
    var t = String(text || "").toLowerCase();
    var i;
    for (i = 0; i < BANNED.length; i++) {
      if (t.indexOf(BANNED[i]) !== -1) return true;
    }
    if (/\b\d{1,3}%\b/.test(t)) return true;
    if (/\b0\.\d+\s*(shed|probability|chance)/i.test(t)) return true;
    return false;
  }

  function snowDepthKnown(today) {
    if (!today) return false;
    if (today.snowDepthKnown === true) return true;
    if (today.snowDepthKnown === false) return false;
    var st = today.snowCoverStatus;
    if (!st || st === "unavailable" || st === "unknown") return false;
    return true;
  }

  /**
   * RAW → DERIVED terrain feature. Geometric only — not wildlife.
   */
  function deriveFeature(raw) {
    raw = raw || {};
    var slope = raw.slopeDeg;
    if (!finiteNum(slope)) {
      return { kind: null, label: null, adjacentSteep: false, slopeRange: null };
    }
    var grades = [];
    var keys = ["northM", "southM", "eastM", "westM"];
    var i;
    if (raw.neighborSlopes && raw.neighborSlopes.length) {
      for (i = 0; i < raw.neighborSlopes.length; i++) {
        if (finiteNum(raw.neighborSlopes[i])) grades.push(raw.neighborSlopes[i]);
      }
    } else {
      var stepM = raw.stepM != null ? raw.stepM : 60;
      for (i = 0; i < keys.length; i++) {
        var g = directionalGradeDeg(raw.elevM, raw[keys[i]], stepM);
        if (g != null) grades.push(g);
      }
    }
    var adjMax = grades.length ? Math.max.apply(null, grades) : slope;
    var adjMin = grades.length ? Math.min.apply(null, grades.concat([slope])) : slope;
    var slopeRange = adjMax - adjMin;
    var adjacentSteep = adjMax >= STEEP_NEIGHBOR && slope < STEEP_NEIGHBOR;

    var n = raw.northM;
    var s = raw.southM;
    var e = raw.eastM;
    var w = raw.westM;
    var c = raw.elevM;
    var ridge = finiteNum(c) && finiteNum(n) && finiteNum(s) && finiteNum(e) && finiteNum(w) &&
      c >= n + RELIEF_M && c >= s + RELIEF_M && c >= e + RELIEF_M && c >= w + RELIEF_M;
    var drainage = finiteNum(c) && finiteNum(n) && finiteNum(s) && finiteNum(e) && finiteNum(w) &&
      c <= n - RELIEF_M && c <= s - RELIEF_M && c <= e - RELIEF_M && c <= w - RELIEF_M;

    var kind;
    if (slope >= VERY_STEEP) kind = "steep";
    else if (slope < GENTLE_MAX && adjacentSteep) kind = "bench";
    else if (ridge && slope < STEEP_PENALTY) kind = "ridge";
    else if (drainage && slope < STEEP_PENALTY) kind = "drainage";
    else if (slope < GENTLE_MAX && slopeRange >= DIFF_RANGE_MIN) kind = "transition";
    else if (slope < GENTLE_MAX && slopeRange < FLAT_RANGE_MAX) kind = "undifferentiated";
    else if (slope >= STEEP_PENALTY) kind = "steep";
    else if (slope < GENTLE_MAX) kind = "gentle";
    else kind = "hillside";

    var aspectCard = slope >= ASPECT_MIN_SLOPE ? aspectCardinal(raw.aspectDeg) : null;
    var facing = aspectFacingPhrase(aspectCard);
    var label = featureLabel(kind, slope, facing);
    return {
      kind: kind,
      label: label,
      adjacentSteep: adjacentSteep,
      slopeRange: Math.round(slopeRange * 10) / 10,
      aspectCardinal: aspectCard,
      facing: facing
    };
  }

  function featureLabel(kind, slope, facing) {
    var face = facing ? facing + " " : "";
    if (kind === "bench") {
      return "Gentle " + face + "bench beside steeper terrain.";
    }
    if (kind === "transition") {
      return "Walkable " + face + "terrain transition.";
    }
    if (kind === "steep") {
      return "Steep " + face + "terrain.";
    }
    if (kind === "ridge") {
      return "Local " + face + "ridge.";
    }
    if (kind === "drainage") {
      return "Local " + face + "valley / drainage.";
    }
    if (kind === "undifferentiated") {
      return "Limited terrain differentiation" + (facing ? " (" + facing + ")" : "") + ".";
    }
    if (kind === "gentle") {
      return "Gentle " + face + "terrain.";
    }
    if (kind === "hillside") {
      return (facing ? facing.charAt(0).toUpperCase() + facing.slice(1) + " hillside." : "Hillside terrain.");
    }
    return finiteNum(slope) ? "Slope " + slope + "°." : null;
  }

  /**
   * Base terrain priority from derived feature. Today context is not applied here.
   */
  function priorityFromFeature(feature, slopeDeg) {
    if (!feature || !feature.kind || !finiteNum(slopeDeg)) return null;
    if (feature.kind === "steep") return "Lower";
    if (feature.kind === "undifferentiated") return "Lower";
    if (feature.kind === "bench") return "Higher";
    if (feature.kind === "transition" && slopeDeg < GENTLE_MAX) return "Higher";
    if (slopeDeg >= STEEP_PENALTY) return "Lower";
    return "Moderate";
  }

  function whyFor(feature, slopeDeg, today) {
    var lines = [];
    if (!feature || !feature.kind) return lines;
    if (feature.kind === "bench") {
      lines.push("Terrain transition may be worth checking.");
    } else if (feature.kind === "transition") {
      lines.push("A change in slope is a terrain feature worth checking.");
    } else if (feature.kind === "ridge") {
      lines.push("Ridge terrain can be a useful search line along the crest and shoulders.");
    } else if (feature.kind === "drainage") {
      lines.push("Valley / drainage terrain may be worth checking along the floor or shoulders.");
    } else if (feature.kind === "steep") {
      lines.push("Steep terrain reduces search practicality.");
    } else if (feature.kind === "undifferentiated") {
      lines.push("Limited terrain differentiation — nothing here strongly stands out.");
    } else {
      lines.push("Walkable terrain with modest structure.");
    }

    if (finiteNum(slopeDeg)) {
      if (slopeDeg < GENTLE_MAX) {
        lines.push("Gentle to moderate slope should be relatively searchable.");
      } else if (slopeDeg >= STEEP_PENALTY) {
        lines.push("Steeper ground is a search-effort penalty.");
      }
    }

    var sun = solarWhy(feature, today);
    if (sun) lines.push(sun);

    return lines.slice(0, 3);
  }

  function isSouthish(cardinal) {
    return cardinal === "S" || cardinal === "SE" || cardinal === "SW";
  }

  function solarWhy(feature, today) {
    if (!feature || !isSouthish(feature.aspectCardinal)) return null;
    var ft = today && today.freezeThawStatus;
    var trend = today && today.tempTrendStatus;
    var seasonalOk = today && today.seasonCategory && today.seasonCategory !== "outside";
    if (ft === "freeze_thaw" || trend === "warming") {
      if (seasonalOk) {
        return "Sun-exposed terrain can lose lingering snow sooner. That can change how practical the ground is to search.";
      }
      return "Sun-exposed terrain may be easier to search when snow is present — seasonal timing is still separate.";
    }
    return "South-facing slopes generally receive more winter sun — physical geography, not a wildlife claim.";
  }

  function todayNotes(today, feature, basePriority) {
    var notes = [];
    today = today || {};
    var cat = today.seasonCategory;
    if (cat === "outside") {
      notes.push(
        "Seasonal timing is outside the main shed-search window — this map still describes terrain, not whether today is favorable to hunt."
      );
    }
    var known = snowDepthKnown(today);
    var snow = today.snowCoverStatus;
    if (!known || snow === "unavailable") {
      if (today.available) {
        notes.push("Measured snow depth is unavailable, so this does not treat the ground as snow-free.");
      }
    } else if (snow === "limiting" || snow === "deep") {
      notes.push(
        "Snow depth is limiting — easier or more exposed ground may be more practical to search. Terrain priority is unchanged."
      );
    }
    return {
      notes: notes,
      basePriorityUnchanged: true,
      displayPriority: basePriority
    };
  }

  function statusForInputs(opts) {
    opts = opts || {};
    var zoom = opts.zoom;
    var elevStatus = opts.elevStatus;
    var terrainStatus = opts.terrainStatus;
    if (elevStatus === "loading" || terrainStatus === "loading" ||
        elevStatus === "idle" || terrainStatus === "idle") return "loading";
    if (finiteNum(zoom) && zoom < MIN_INSPECT_ZOOM) return "insufficient_zoom";
    if (elevStatus === "failed" || terrainStatus === "failed") return "failed";
    if (elevStatus === "unavailable" && terrainStatus !== "ready") return "unavailable";
    if (terrainStatus === "unavailable" && elevStatus !== "ready") return "unavailable";
    if (opts.stepM != null && finiteNum(opts.stepM) && opts.stepM > MAX_CELL_STEP_M) {
      return "insufficient_zoom";
    }
    return "ready_check";
  }

  function emptyResult(status, extra) {
    extra = extra || {};
    var message =
      status === "insufficient_zoom" ? COPY.ZOOM
        : status === "incomplete" ? COPY.INCOMPLETE
          : status === "loading" ? COPY.LOADING
            : status === "failed" ? COPY.FAILED
              : COPY.UNAVAILABLE;
    return Object.assign({
      version: VERSION,
      status: status,
      priority: null,
      basePriority: null,
      band: null,
      raw: extra.raw || null,
      feature: extra.feature || null,
      why: extra.why || [],
      todayNotes: extra.todayNotes || [],
      fieldNote: COPY.FIELD_NOTE,
      message: message,
      hudText: formatInspectHud({
        status: status,
        priority: null,
        feature: extra.feature || null,
        raw: extra.raw || null,
        why: extra.why || [],
        todayNotes: extra.todayNotes || [],
        fieldNote: COPY.FIELD_NOTE,
        message: message
      })
    }, extra);
  }

  /**
   * Point evaluation for Inspect.
   */
  function evaluatePoint(opts) {
    opts = opts || {};
    var today = opts.today || {};
    var st = statusForInputs(opts);
    if (st === "loading") return emptyResult("loading");
    if (st === "insufficient_zoom") {
      return emptyResult("insufficient_zoom", {
        why: ["This view is too coarse for a local search-priority reading."]
      });
    }
    if (st === "failed") return emptyResult("failed");
    if (st === "unavailable") return emptyResult("unavailable");

    var rawIn = opts.raw || {};
    var slopePack = null;
    if (finiteNum(rawIn.slopeDeg)) {
      slopePack = {
        slopeDeg: rawIn.slopeDeg,
        aspectDeg: rawIn.aspectDeg,
        elevM: rawIn.elevM
      };
    } else if (
      finiteNum(rawIn.elevM) &&
      finiteNum(rawIn.northM) &&
      finiteNum(rawIn.southM) &&
      finiteNum(rawIn.eastM) &&
      finiteNum(rawIn.westM)
    ) {
      slopePack = slopeAspectFromElevNeighbors({
        centerM: rawIn.elevM,
        northM: rawIn.northM,
        southM: rawIn.southM,
        eastM: rawIn.eastM,
        westM: rawIn.westM,
        stepM: rawIn.stepM
      });
    }

    if (!slopePack || !finiteNum(slopePack.slopeDeg)) {
      return emptyResult("incomplete", {
        raw: { elevM: rawIn.elevM || null, slopeDeg: null, aspectDeg: null }
      });
    }

    var raw = {
      elevM: slopePack.elevM != null ? slopePack.elevM : rawIn.elevM,
      slopeDeg: slopePack.slopeDeg,
      aspectDeg: slopePack.slopeDeg >= ASPECT_MIN_SLOPE ? slopePack.aspectDeg : null,
      northM: rawIn.northM,
      southM: rawIn.southM,
      eastM: rawIn.eastM,
      westM: rawIn.westM,
      neighborSlopes: rawIn.neighborSlopes,
      stepM: rawIn.stepM != null ? rawIn.stepM : 60
    };
    var feature = deriveFeature(raw);
    var base = priorityFromFeature(feature, raw.slopeDeg);
    if (!base) {
      return emptyResult("incomplete", { raw: raw, feature: feature });
    }
    var ctx = todayNotes(today, feature, base);
    var why = whyFor(feature, raw.slopeDeg, today);
    var result = {
      version: VERSION,
      status: "ready",
      priority: ctx.displayPriority,
      basePriority: base,
      band: bandId(base),
      raw: {
        elevM: raw.elevM,
        slopeDeg: raw.slopeDeg,
        aspectDeg: raw.aspectDeg,
        aspectCardinal: feature.aspectCardinal
      },
      feature: feature,
      why: why,
      todayNotes: ctx.notes,
      fieldNote: COPY.FIELD_NOTE,
      message: null,
      todayDidNotOverride: ctx.basePriorityUnchanged
    };
    result.hudText = formatInspectHud(result);
    return result;
  }

  function bandId(priority) {
    if (priority === "Higher") return "higher";
    if (priority === "Moderate") return "moderate";
    if (priority === "Lower") return "lower";
    return null;
  }

  function terrainBlock(raw, feature) {
    var lines = [];
    if (feature && feature.label) lines.push(feature.label.replace(/\.$/, ""));
    var bits = [];
    if (raw && finiteNum(raw.slopeDeg)) bits.push("slope " + raw.slopeDeg + "°");
    if (feature && feature.facing) bits.push(feature.facing);
    if (raw && finiteNum(raw.elevM)) {
      bits.push("~" + Math.round(raw.elevM) + " m (" + formatElevFt(raw.elevM) + ")");
    }
    if (bits.length) lines.push(bits.join(" · "));
    return lines.join("\n");
  }

  function formatInspectHud(result) {
    result = result || {};
    var status = result.status;
    if (status && status !== "ready") {
      var head = result.message ||
        (status === "insufficient_zoom" ? COPY.ZOOM
          : status === "incomplete" ? COPY.INCOMPLETE
            : status === "loading" ? COPY.LOADING
              : COPY.UNAVAILABLE);
      var parts = [head];
      if (status === "insufficient_zoom") {
        parts.push("");
        parts.push("Why");
        parts.push("• Zoom in for a local terrain reading. Coarse views cannot assign a search priority.");
      } else if (status === "incomplete" || status === "unavailable" || status === "failed") {
        parts.push("");
        parts.push("Why");
        parts.push("• " + COPY.MISSING_NOT_MODERATE);
      }
      parts.push("");
      parts.push("Field note");
      parts.push(COPY.FIELD_NOTE);
      return parts.join("\n");
    }

    var out = [];
    out.push("Search priority: " + (result.priority || "—"));
    out.push("");
    out.push("Terrain");
    var terr = terrainBlock(result.raw, result.feature);
    out.push(terr || "Terrain sample available.");
    out.push("");
    out.push("Why");
    var why = (result.why || []).slice();
    var today = result.todayNotes || [];
    var i;
    var used = 0;
    for (i = 0; i < why.length && used < 3; i++) {
      out.push("• " + why[i]);
      used += 1;
    }
    var fieldBits = [result.fieldNote || COPY.FIELD_NOTE];
    for (i = 0; i < today.length; i++) {
      if (used < 3 && today[i] && !/outside the main shed-search window/.test(today[i])) {
        out.push("• " + today[i]);
        used += 1;
      } else if (today[i]) {
        fieldBits.push(today[i]);
      }
    }
    if (!used) out.push("• Terrain context is limited.");
    out.push("");
    out.push("Field note");
    out.push(fieldBits.join(" "));
    return out.join("\n");
  }

  function todayContextFromHunt(hunt) {
    if (!hunt) return { available: false };
    var ch = hunt.channels || {};
    var snowCover = ch.snowCover || {};
    var freeze = ch.freezeThaw || {};
    var trend = ch.tempTrend || {};
    return {
      available: true,
      seasonCategory: hunt.season && hunt.season.category,
      seasonLabel: hunt.season && hunt.season.label,
      snowCoverStatus: snowCover.status || "unavailable",
      snowDepthKnown: snowCover.status === "none" || snowCover.status === "light" ||
        snowCover.status === "limiting" || snowCover.status === "deep"
        ? true
        : false,
      freezeThawStatus: freeze.status || null,
      tempTrendStatus: trend.status || null
    };
  }

  /**
   * Overlay grid. elevations is a halo array of (rows+2)*(cols+2).
   * Today is accepted but MUST NOT change cell priority.
   */
  function evaluateGrid(opts) {
    opts = opts || {};
    var zoom = opts.zoom;
    var rows = opts.rows != null ? opts.rows : GRID_ROWS;
    var cols = opts.cols != null ? opts.cols : GRID_COLS;
    var bounds = opts.bounds;
    var elevations = opts.elevations;
    bounds = clampSearchBounds(bounds);
    var haloRows = rows + HALO * 2;
    var haloCols = cols + HALO * 2;

    if (finiteNum(zoom) && zoom < MIN_ZOOM) {
      return {
        renderMode: "search-priority",
        status: "insufficient_zoom",
        rows: 0,
        cols: 0,
        cells: [],
        bounds: bounds || null,
        message: COPY.ZOOM
      };
    }
    if (!elevations || !elevations.length) {
      return {
        renderMode: "search-priority",
        status: "unavailable",
        rows: 0,
        cols: 0,
        cells: [],
        bounds: bounds || null,
        message: COPY.UNAVAILABLE
      };
    }
    if (elevations.length < haloRows * haloCols) {
      return {
        renderMode: "search-priority",
        status: "incomplete",
        rows: 0,
        cols: 0,
        cells: [],
        bounds: bounds || null,
        message: COPY.INCOMPLETE
      };
    }

    var step = stepMetersFromBounds(bounds, haloRows, haloCols);
    var stepM = step ? step.mean : 60;
    if (stepM > MAX_CELL_STEP_M) {
      return {
        renderMode: "search-priority",
        status: "insufficient_zoom",
        rows: 0,
        cols: 0,
        cells: [],
        bounds: bounds || null,
        message: COPY.ZOOM
      };
    }

    var slopeGrid = [];
    var r;
    var c;
    function haloAt(hr, hc) {
      var v = elevations[hr * haloCols + hc];
      return finiteNum(v) ? v : null;
    }
    for (r = 0; r < rows; r++) {
      slopeGrid[r] = [];
      for (c = 0; c < cols; c++) {
        var hr = r + HALO;
        var hc = c + HALO;
        slopeGrid[r][c] = slopeAspectFromElevNeighbors({
          centerM: haloAt(hr, hc),
          northM: haloAt(hr - 1, hc),
          southM: haloAt(hr + 1, hc),
          eastM: haloAt(hr, hc + 1),
          westM: haloAt(hr, hc - 1),
          stepM: stepM
        });
      }
    }

    var cells = [];
    var west = bounds.west;
    var east = bounds.east;
    var south = bounds.south;
    var north = bounds.north;
    var ready = 0;
    var skipped = 0;
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var pack = slopeGrid[r][c];
        var lat = north - (r + 0.5) * (north - south) / rows;
        var lng = west + (c + 0.5) * (east - west) / cols;
        var neighborSlopes = [];
        var dr;
        var dc;
        for (dr = -1; dr <= 1; dr++) {
          for (dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            var rr = r + dr;
            var cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
            var nb = slopeGrid[rr][cc];
            if (nb && finiteNum(nb.slopeDeg)) neighborSlopes.push(nb.slopeDeg);
          }
        }
        var cell;
        if (!pack || !finiteNum(pack.slopeDeg)) {
          skipped += 1;
          cell = {
            row: r,
            col: c,
            lat: lat,
            lng: lng,
            band: null,
            status: "incomplete",
            outsideArea: false
          };
        } else {
          var ev = evaluatePoint({
            zoom: zoom != null ? zoom : MIN_ZOOM,
            elevStatus: "ready",
            terrainStatus: "ready",
            raw: {
              elevM: pack.elevM,
              slopeDeg: pack.slopeDeg,
              aspectDeg: pack.aspectDeg,
              northM: haloAt(r + HALO - 1, c + HALO),
              southM: haloAt(r + HALO + 1, c + HALO),
              eastM: haloAt(r + HALO, c + HALO + 1),
              westM: haloAt(r + HALO, c + HALO - 1),
              neighborSlopes: neighborSlopes,
              stepM: stepM
            },
            today: { available: false }
          });
          if (ev.status !== "ready" || !ev.band) {
            skipped += 1;
            cell = {
              row: r,
              col: c,
              lat: lat,
              lng: lng,
              band: null,
              status: ev.status || "incomplete",
              outsideArea: false
            };
          } else {
            ready += 1;
            cell = {
              row: r,
              col: c,
              lat: lat,
              lng: lng,
              band: ev.band,
              priorityLabel: ev.priority,
              status: "ready",
              slopeDeg: ev.raw.slopeDeg,
              aspectCardinal: ev.feature && ev.feature.aspectCardinal,
              featureKind: ev.feature && ev.feature.kind,
              outsideArea: false
            };
          }
        }
        cells.push(cell);
      }
    }

    var status = ready === 0 ? (skipped ? "incomplete" : "unavailable") : "ready";
    return {
      renderMode: "search-priority",
      modelVersion: "search-priority-" + VERSION,
      status: status,
      rows: rows,
      cols: cols,
      cells: cells,
      bounds: bounds,
      readyCount: ready,
      skippedCount: skipped,
      stepM: Math.round(stepM),
      message: status === "ready" ? null : COPY.INCOMPLETE,
      disclaimer: "Search priority from terrain — not a find probability."
    };
  }

  function haloPointCount(rows, cols) {
    rows = rows != null ? rows : GRID_ROWS;
    cols = cols != null ? cols : GRID_COLS;
    return (rows + 2) * (cols + 2);
  }

  function haloLatLngs(bounds, rows, cols) {
    rows = rows != null ? rows : GRID_ROWS;
    cols = cols != null ? cols : GRID_COLS;
    var haloRows = rows + 2;
    var haloCols = cols + 2;
    var lats = [];
    var lngs = [];
    var r;
    var c;
    var cellH = (bounds.north - bounds.south) / rows;
    var cellW = (bounds.east - bounds.west) / cols;
    for (r = -1; r < rows + 1; r++) {
      for (c = -1; c < cols + 1; c++) {
        lats.push(bounds.north - (r + 0.5) * cellH);
        lngs.push(bounds.west + (c + 0.5) * cellW);
      }
    }
    return { lats: lats, lngs: lngs, haloRows: haloRows, haloCols: haloCols };
  }

  global.WaypointShedsSearchPriority = {
    VERSION: VERSION,
    MIN_ZOOM: MIN_ZOOM,
    MIN_INSPECT_ZOOM: MIN_INSPECT_ZOOM,
    GRID_ROWS: GRID_ROWS,
    GRID_COLS: GRID_COLS,
    PRIORITIES: PRIORITIES,
    COPY: COPY,
    aspectCardinal: aspectCardinal,
    aspectFacingPhrase: aspectFacingPhrase,
    slopeAspectFromElevNeighbors: slopeAspectFromElevNeighbors,
    deriveFeature: deriveFeature,
    priorityFromFeature: priorityFromFeature,
    evaluatePoint: evaluatePoint,
    evaluateGrid: evaluateGrid,
    formatInspectHud: formatInspectHud,
    todayContextFromHunt: todayContextFromHunt,
    todayNotes: todayNotes,
    snowDepthKnown: snowDepthKnown,
    containsBannedLanguage: containsBannedLanguage,
    clampSearchBounds: clampSearchBounds,
    haloPointCount: haloPointCount,
    haloLatLngs: haloLatLngs,
    stepMetersFromBounds: stepMetersFromBounds
  };
})(typeof window !== "undefined" ? window : globalThis);
