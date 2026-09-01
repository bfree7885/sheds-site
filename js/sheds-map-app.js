/**
 * Sheds Field Map — full-screen field experience (V1).
 * Map-first outdoor shell: floating controls, bottom sheet, GPS focus.
 */
(function () {
  "use strict";

  var Store = window.WaypointShedsObservations;
  var Model = window.WaypointShedsLikelihood;
  var Bio = window.WaypointShedsBiological;
  var Heat = window.WaypointShedsHeat;
  var Sessions = window.WaypointShedsSessions;
  var Planner = window.WaypointShedsPlanner;
  var Presets = window.WaypointShedsPresets;
  var Validation = window.WaypointShedsValidation;
  var Patterns = window.WaypointShedsObservationPatterns;
  var TodaysSearch = window.WaypointShedsTodaysSearch;
  var Timing = window.WaypointShedsTiming;
  var Habitat = window.WaypointShedsHabitat;
  var Searchability = window.WaypointShedsSearchability;
  var Weather = window.WaypointShedsWeather;
  var TodayHunt = window.WaypointShedsTodayHunt;
  var Confidence = window.WaypointShedsConfidence;
  var SearchArea = window.WaypointShedsSearchArea;
  var GisPack = window.WaypointShedsGisPack;
  var HabitatGis = window.WaypointShedsHabitatGis;
  var SglOverlay = window.WaypointShedsSglOverlay;
  var AreaStore = window.WaypointShedsSearchAreaStore;
  var ScoutStore = window.WaypointShedsScoutSpots;
  var HuntPlans = window.WaypointShedsHuntPlans;
  var FieldPlan = window.WaypointShedsFieldPlan;
  var FieldUi = window.WaypointShedsFieldUi;
  var Ux = window.WaypointShedsUxPolish;
  var FieldTools = window.WaypointShedsFieldTools;
  var InspectIntel = window.WaypointShedsInspectIntel;
  var SearchPriority = window.WaypointShedsSearchPriority;

  var NEUTRAL = { lat: 44.5, lng: -92.5, zoom: 6 }; // Midwest overview — not “you”
  var GRID_ROWS = 18;
  var GRID_COLS = 18;
  var COARSE_ROWS = 10;
  var COARSE_COLS = 10;
  var SPECIES_LABEL = "Whitetail deer";
  var DEFAULT_HEAT_OPACITY = 0.42;
  var GPS_DENIED_KEY = "waypoint-sheds-gps-denied-v1";
  /** Explicit location SOT — never conflate these into similar map dots. */
  var LOCATION_KIND = Object.freeze({
    USER_GPS: "user_gps",
    USER_APPROXIMATE: "user_approximate",
    SEARCH_LOCATION: "search_location",
    SEARCH_TARGET: "search_target",
    MAP_CENTER: "map_center",
    NONE: "none"
  });
  var GPS_MOVE_MIN_M = 8; // ignore sub-threshold GPS jitter (stable input → stable marker)
  var GPS_APPROX_M = 80;
  /** Phase 2: deliberate Analyze-at-YOU only when accuracy ≤ this (documented in SHEDS-2-PHASE-2-HABITAT-GIS.md). */
  var SEARCH_YOU_ACCURACY_MAX_M = (SearchArea && SearchArea.YOU_ACCURACY_MAX_M) || 500;
  var SEARCH_RADIUS_KEY = (SearchArea && SearchArea.DEFAULT_RADIUS_KEY) || "medium";

  var state = {
    locationStatus: "idle",
    locationKind: LOCATION_KIND.NONE,
    /** Canonical selected location — all dependents consume this. */
    selectedLocation: null,
    userLatLng: null,
    accuracyM: null,
    headingDeg: null,
    watchId: null,
    prefs: null,
    filterTypes: null,
    elevCache: null,
    elevKey: "",
    elevAbort: null,
    elevFetchGen: 0,
    weather: null,
    weatherStatus: "idle",
    weatherFetchGen: 0,
    locateGen: 0,
    recomputeTimer: null,
    recomputeGen: 0,
    heatPhase: "idle",
    heatMode: "habitat",
    heatFilters: null,
    firstEthicsShown: false,
    tracking: false,
    activeSessionId: null,
    lastPlan: null,
    lastToday: null,
    lastGrid: null,
    lastChannels: null,
    lastPerf: {},
    offlineForced: false,
    followUser: false,
    userPanned: false,
    planExpanded: false,
    lastClickAt: 0,
    lastFocusEl: null,
    tileStatus: null,
    /** Phase 2 SEARCH LOCATION — never auto-set from coarse YOU. */
    searchLocation: null,
    searchRadiusKey: SEARCH_RADIUS_KEY,
    activeSearchAreaId: null,
    activeSearchAreaName: null,
    gisPacks: [],
    activeGisPack: null,
    gisLoadStatus: "idle",
    sglVisible: false,
    sglLayer: null,
    searchMarker: null,
    searchAreaCircle: null,
    lastSearchSnapshot: null,
    basemapId: "street",
    measureActive: false,
    measurePoints: [],
    inspectArmed: false,
    inspectLatLng: null,
    inspectElevGen: 0,
    inspectElevM: null,
    inspectElevStatus: "idle",
    inspectTerrainDerived: null,
    inspectTerrainStatus: "idle",
    inspectTerrainNeighbors: null,
    inspectReport: null,
    inspectPriority: null,
    searchAreasVisible: false,
    searchAreasAbort: null,
    searchAreasFetchGen: 0,
    searchAreasTimer: null,
    searchAreasStatus: "idle",
    lastSearchAreasGrid: null,
    scoutSpotId: null,
    huntPlanId: null,
    huntSelecting: false,
    huntSelectIds: [],
    pendingHuntPlanIds: null
  };

  var els = {};
  var map, heatLayer, userMarker, accuracyCircle, headingLine, obsLayer, scoutLayer, clickLatLng;
  var trackLayer, coverageLayer, planLayer, recMarker, trackLine;
  var searchLayer, sglLayerGroup;
  var basemapsBundle = null;
  var basemapLayersControl = null;
  var measureLayer = null;
  var measureLine = null;
  var inspectMarker = null;
  var searchAreasLayer = null;

  function $(id) { return document.getElementById(id); }

  function setLocStatus(code, detail) {
    state.locationStatus = code;
    var label = {
      idle: "You · tap to place",
      finding: "Finding you…",
      available: "You are here",
      denied: "Permission denied",
      unavailable: "Location unavailable",
      timeout: "Location timed out",
      unsupported: "Location unsupported",
      last: "Saved view",
      manual: "Exploring the map",
      neutral: "You · tap to place"
    }[code] || code;
    if (els.locStatus) {
      var text = label;
      if (code === "available" && detail && detail.indexOf("±") === 0) text = "You are here · " + detail;
      else if (code === "available" && detail === "tracking") text = "You are here · tracking";
      else if (code === "available" && detail && detail.indexOf("approximate") >= 0) {
        text = "YOU · approx" + (detail.indexOf("±") >= 0 ? " · " + detail : "");
      } else if (
        detail &&
        (code === "denied" || code === "unavailable" || code === "timeout" || code === "unsupported" || code === "finding")
      ) {
        // Keep failure modes readable in the chip — never look like a successful map-center “you”.
        text = detail.length > 56 ? label + " — tap Locate" : detail;
      }
      els.locStatus.textContent = text;
      els.locStatus.dataset.state = code;
      els.locStatus.title = detail ? label + " — " + detail : label;
    }
    var dot = $("nav-dot");
    if (dot) {
      var dotState = state.tracking ? "tracking" : code;
      dot.dataset.state = dotState;
    }
    updateNavMeta();
    syncRecenterBtn();
    if (state.lastPlan != null || state.lastToday) {
      try { renderPlanCard(state.lastPlan); } catch (e) { /* boot order */ }
    }
  }

  function syncRecenterBtn() {
    var btn = $("btn-recenter");
    if (!btn) return;
    var show = !!(state.userLatLng && !state.followUser);
    btn.hidden = !show;
  }

  function setFabLabel(btn, label) {
    if (!btn) return;
    var text = String(label || "").trim();
    btn.setAttribute("aria-label", text);
    btn.title = text;
    var span = btn.querySelector(".sheds-fab__label");
    if (span) {
      /* Short dock labels: Search / End — keep aria-label as the full phrase. */
      span.textContent = /^stop/i.test(text)
        ? "Stop"
        : /^end/i.test(text)
          ? "End"
          : /^(start|resume)/i.test(text)
            ? "Search"
            : text.split(/\s+/)[0];
    }
  }

  function syncSessionPill(text, show) {
    if (!els.sessionPill) return;
    if (text != null) els.sessionPill.textContent = text;
    if (show) {
      els.sessionPill.hidden = false;
      els.sessionPill.removeAttribute("hidden");
    } else {
      els.sessionPill.hidden = true;
      els.sessionPill.setAttribute("hidden", "");
    }
  }

  function confidencePhrase(coverage, band) {
    var level = (coverage && coverage.level) || "limited";
    if (level === "strong" && band === "higher") return "Stronger relative confidence";
    if (level === "strong") return "Solid relative confidence";
    if (level === "moderate" && band === "higher") return "Worth considering";
    if (level === "moderate") return "Moderate confidence";
    if (band === "higher") return "Limited inputs — still worth a look";
    return "Limited inputs — walk carefully";
  }

  function wasGpsDenied() {
    try {
      return localStorage.getItem(GPS_DENIED_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function rememberGpsDenied(denied) {
    try {
      if (denied) localStorage.setItem(GPS_DENIED_KEY, "1");
      else localStorage.removeItem(GPS_DENIED_KEY);
    } catch (e) { /* private mode */ }
  }

  /**
   * Live permission probe — sticky localStorage denial must not outrank a later grant.
   * @returns {Promise<"granted"|"denied"|"prompt"|"unknown">}
   */
  function probeGeolocationPermission() {
    return new Promise(function (resolve) {
      if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
        resolve("unknown");
        return;
      }
      try {
        navigator.permissions.query({ name: "geolocation" }).then(
          function (status) {
            resolve(status && status.state ? status.state : "unknown");
          },
          function () {
            resolve("unknown");
          }
        );
      } catch (e) {
        resolve("unknown");
      }
    });
  }

  /** Interpret weather + season into field language (not raw mm / kph). */
  function fieldConditionLines(weather, season) {
    var lines = [];
    var wx = weather;
    if (wx) {
      var snow = wx.snowMm;
      var temp = wx.tempC;
      var windMs = wx.windSpeedMs;
      if (snow != null && snow > 8 && temp != null && temp > 0) {
        lines.push("Recent snowmelt may expose south-facing slopes and bare edges.");
      } else if (snow != null && snow > 25) {
        lines.push("Deeper snow can hide antlers — favor wind-scoured ridges and openings.");
      } else if (snow != null && snow > 0.5) {
        lines.push("Light snow can improve ground contrast for spotting sheds.");
      }
      if (windMs != null && windMs >= 8) {
        lines.push("Stronger winds may concentrate antlers along fence lines and lee edges.");
      } else if (windMs != null && windMs >= 4) {
        lines.push("Breezes can move light debris — check fence lines and travel corridors.");
      }
      if (temp != null && temp >= 12) {
        lines.push("Mild weather and green-up may reduce visibility — slow down under cover.");
      } else if (temp != null && temp <= -5) {
        lines.push("Hard freeze can lock snow crust — look where deer travel and bed.");
      }
    }
    if (season && season.phaseId === "peak_shed") {
      lines.push("Seasonal timing looks closer to peak shed for this latitude.");
    } else if (season && season.phaseId === "late_shed") {
      lines.push("Later-season window — prioritize overlooked pockets and pressure edges.");
    } else if (season && (season.phaseId === "pre_shed" || season.phaseId === "early_shed")) {
      lines.push("Early window — treat every mark as reconnaissance, not a find map.");
    } else if (season && season.phaseId === "post_shed") {
      lines.push("Post-peak window — leftover sheds favor tough cover and missed edges.");
    }
    if (!lines.length) {
      if (navigator.onLine === false || state.offlineForced) {
        lines.push("Working from local notes and season rules — weather feed unavailable.");
      } else {
        lines.push("Conditions look ordinary — lean on terrain, sign, and your coverage marks.");
      }
    }
    return lines.slice(0, 3);
  }

  function dayQualityLine(coverage, band, weather, season) {
    var wx = weather || state.weather;
    if (wx) {
      if (wx.snowMm != null && wx.snowMm > 8 && wx.tempC != null && wx.tempC > 0) {
        return "Snowmelt favors open slopes";
      }
      if (wx.windSpeedMs != null && wx.windSpeedMs >= 8) {
        return "Wind may load fence lines";
      }
      if (wx.tempC != null && wx.tempC >= 12) {
        return "Green-up lowers visibility";
      }
      if (wx.snowMm != null && wx.snowMm > 25) {
        return "Deep snow — pick open ground";
      }
    }
    if (season && season.phaseId === "peak_shed") return "Peak-shed window nearby";
    var level = (coverage && coverage.level) || "limited";
    if (level === "strong" && (band === "higher" || band === "moderate")) return "Looking favorable nearby";
    if (level === "moderate") return "Worth searching nearby";
    if (band === "higher") return "A place worth considering";
    return "Guidance with limited inputs";
  }

  function currentSeasonProfile() {
    if (!Bio) return null;
    var center = map ? map.getCenter() : null;
    var lat = state.userLatLng ? state.userLatLng.lat : (center && center.lat) || 44;
    return Bio.seasonProfile(new Date(), lat, state.prefs || {});
  }

  function syncHeatLegend() {
    var legend = $("heat-legend");
    if (!legend) return;
    var on = !!(state.prefs && state.prefs.heatVisible !== false && state.lastGrid);
    legend.hidden = !on;
    var modeEl = $("heat-legend-mode");
    if (modeEl) {
      syncGuidanceModeLabel();
      modeEl.textContent = state.heatMode === "observed"
        ? "My observations"
        : (state.lastGrid && state.lastGrid.unavailable
          ? "Landscape unavailable"
          : (state.lastGrid && state.lastGrid.habitatEmpty
            ? "No landscape guidance yet"
            : (state.lastGrid && state.lastGrid.renderMode === "gis-bands"
              ? "Landscape · MODEL"
              : "Landscape guidance")));
    }
    var status = $("heat-legend-status");
    if (status) {
      if (state.heatMode === "observed") {
        var n = state.lastGrid && state.lastGrid.observationCount != null
          ? state.lastGrid.observationCount : 0;
        status.textContent = n
          ? (n + " private note" + (n === 1 ? "" : "s") + " in filter")
          : "Empty — log observations to build this view";
      } else if (state.lastGrid && state.lastGrid.renderMode === "gis-bands") {
        status.textContent = state.lastGrid.unavailable
          ? ((Ux && Ux.EMPTY.NO_GIS) || "Landscape guidance isn’t available for this area yet.")
          : "Mapped structure / edge / slope inside SEARCH — not find %";
      } else if (state.heatPhase === "coarse") status.textContent = "Coarse · refining…";
      else if (state.heatPhase === "refine") status.textContent = "Updated for this view";
      else if (state.heatPhase === "zoom") status.textContent = "Zoom in for guidance";
      else if (state.offlineForced || navigator.onLine === false) status.textContent = "Limited / offline scoring";
      else status.textContent = "Mapped landscape guidance (not find %)";
    }
  }

  function locationStatusForToday() {
    if (state.locationStatus === "denied") return "denied";
    if (state.locationStatus === "finding") return state.userLatLng ? "ready" : "loading";
    if (state.locationStatus === "unavailable" || state.locationStatus === "timeout") {
      return state.userLatLng ? "ready" : "unavailable";
    }
    if (state.userLatLng || state.locationStatus === "available") return "ready";
    if (state.locationStatus === "idle" || state.locationStatus === "neutral") return "loading";
    return state.userLatLng ? "ready" : "unavailable";
  }

  /**
   * Place for Today's Hunt. GPS, saved Search/map, or a zoomed map center.
   * Midwest overview (zoom 6) is not treated as the hunter's location.
   */
  function locationForHunt() {
    if (state.userLatLng && isFinite(state.userLatLng.lat) && isFinite(state.userLatLng.lng)) {
      return { lat: state.userLatLng.lat, lng: state.userLatLng.lng, source: "gps" };
    }
    if (state.searchLocation && isFinite(state.searchLocation.lat) && isFinite(state.searchLocation.lng)) {
      return {
        lat: state.searchLocation.lat,
        lng: state.searchLocation.lng,
        source: "saved-area"
      };
    }
    if (Store && typeof Store.loadMapView === "function") {
      var saved = Store.loadMapView();
      if (saved && isFinite(saved.lat) && isFinite(saved.lng)) {
        return { lat: saved.lat, lng: saved.lng, source: "saved-view" };
      }
    }
    if (AreaStore && typeof AreaStore.list === "function") {
      var areas = AreaStore.list();
      if (areas && areas[0] && areas[0].center &&
          isFinite(areas[0].center.lat) && isFinite(areas[0].center.lng)) {
        return { lat: areas[0].center.lat, lng: areas[0].center.lng, source: "saved-area" };
      }
    }
    if (map && typeof map.getZoom === "function" && map.getZoom() >= 10) {
      var c = map.getCenter();
      if (c && isFinite(c.lat) && isFinite(c.lng)) {
        return { lat: c.lat, lng: c.lng, source: "map-center" };
      }
    }
    return null;
  }

  function refreshTodayHunt(plan) {
    if (!TodayHunt) return null;
    var loc = locationForHunt();
    var wx = state.offlineForced ? null : state.weather;
    var weatherStatus = state.offlineForced ? "unavailable"
      : (state.weatherStatus === "loading" ? "loading"
        : (wx ? "ready" : state.weatherStatus || "unavailable"));
    if (!loc) {
      wx = null;
      if (weatherStatus === "ready") weatherStatus = "unavailable";
    }
    var hunt = TodayHunt.compose({
      now: new Date(),
      location: loc,
      weather: wx,
      weatherStatus: weatherStatus,
      patterns: Patterns ? Patterns.aggregatePatterns(Store.list()) : null,
      plan: plan || state.lastPlan,
      prefs: state.prefs || {}
    });
    state.lastHunt = hunt;
    return hunt;
  }

  function renderTodayHunt(hunt) {
    var el = $("today-hunt");
    if (!el || !TodayHunt) return;
    TodayHunt.fillHuntRoot(el, hunt, { includeQuestion: false });
    if (state.scoutSpotId && ScoutStore) {
      var open = ScoutStore.getById(state.scoutSpotId);
      if (open) renderScoutHud(open);
    }
    if (state.huntPlanId && HuntPlans) {
      var openPlan = HuntPlans.getById(state.huntPlanId);
      if (openPlan) renderHuntPlanHud(openPlan);
    }
  }

  function currentHeatFilters() {
    var base = Patterns && Patterns.defaultHeatFilters
      ? Patterns.defaultHeatFilters()
      : { timeOfDay: "all", season: "all", weather: "any", sinceMs: null, untilMs: null };
    var f = Object.assign({}, base, state.heatFilters || {});
    var range = f.rangeDays;
    if (range && range !== "all") {
      var days = Number(range);
      if (isFinite(days) && days > 0) f.sinceMs = Date.now() - days * 86400000;
    }
    return f;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderTodayWindows(brief) {
    var el = $("today-windows");
    if (!el) return;
    if (!brief || !brief.timeWindows || !brief.timeWindows.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = brief.timeWindows.map(function (w) {
      var active = w.id === brief.bestWindowId ? " is-best" : "";
      return "<div class=\"sheds-today__window" + active + "\" data-band=\"" + escapeHtml(w.band) + "\">" +
        "<span class=\"sheds-today__window-label\">" + escapeHtml(w.label) + "</span>" +
        "<span class=\"sheds-today__window-band\">" + escapeHtml(w.band) + "</span>" +
        "<span class=\"sheds-today__window-why\">" + escapeHtml((w.why && w.why[0]) || "") + "</span>" +
        "</div>";
    }).join("");
  }

  function renderTodayAreas(brief) {
    var el = $("today-areas");
    if (!el) return;
    if (!brief || !brief.areas || !brief.areas.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = "<p class=\"sheds-today__section-label\">Areas / terrain to consider</p><ul>" +
      brief.areas.map(function (a) {
        var tag = a.epistemic === "observed" || a.kind === "observation" ? "Pattern"
          : a.epistemic === "estimated" || a.kind === "planner" ? "Estimated"
          : a.epistemic === "fact" ? "Fact" : "Analysis";
        return "<li><strong>" + escapeHtml(a.label) + "</strong> " +
          "<span class=\"sheds-today__tag\">" + tag + "</span>" +
          "<span class=\"sheds-today__area-why\">" + escapeHtml(a.why || "") + "</span></li>";
      }).join("") + "</ul>";
  }

  function renderTodaySignals(brief) {
    var el = $("today-signals");
    if (!el) return;
    if (!brief || !brief.signals || !brief.signals.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = brief.signals.map(function (s) {
      return "<li data-kind=\"" + escapeHtml(s.kind) + "\"><span class=\"sheds-today__tag\">" +
        escapeHtml(s.kind) + "</span> <strong>" + escapeHtml(s.label) + ":</strong> " +
        escapeHtml(s.text) + "</li>";
    }).join("");
  }

  function refreshTodaysSearch(plan) {
    if (!TodaysSearch || !els.planCard) return null;
    var patterns = Patterns ? Patterns.aggregatePatterns(Store.list()) : null;
    var brief = TodaysSearch.build({
      weather: state.offlineForced ? null : state.weather,
      weatherStatus: state.offlineForced ? "unavailable"
        : (state.weatherStatus === "loading" ? "loading"
          : (state.weather ? "ready" : state.weatherStatus || "unavailable")),
      season: currentSeasonProfile(),
      locationStatus: locationStatusForToday(),
      patterns: patterns,
      plan: plan || state.lastPlan,
      now: new Date()
    });
    state.lastToday = brief;
    return brief;
  }

  function updateNavMeta() {
    var meta = $("nav-meta");
    var accEl = $("nav-accuracy");
    var headEl = $("nav-heading");
    var targetEl = $("nav-to-target");
    if (!meta) return;
    var bits = 0;
    // Accuracy lives in the here chip ("You are here · ±N m") — do not duplicate under it.
    if (accEl) accEl.textContent = "";
    if (headEl) {
      if (state.headingDeg != null && isFinite(state.headingDeg)) {
        var dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        var ix = Math.round(((state.headingDeg % 360) / 45)) % 8;
        headEl.textContent = dirs[ix] + " " + Math.round(state.headingDeg) + "°";
        bits++;
      } else headEl.textContent = "";
    }
    // Target bearing/distance is owned by Today's Search — keep HUD from competing with briefing.
    if (targetEl) targetEl.textContent = "";
    meta.hidden = bits === 0;
  }

  function metersBetween(a, b) {
    if (!a || !b) return Infinity;
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad;
    var dLng = (b.lng - a.lng) * toRad;
    var lat1 = a.lat * toRad;
    var lat2 = b.lat * toRad;
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function publishLocationDebug() {
    try {
      window.__SHEDS_LOCATION__ = {
        kind: state.locationKind,
        selectedLocation: state.selectedLocation,
        lat: state.userLatLng ? state.userLatLng.lat : null,
        lng: state.userLatLng ? state.userLatLng.lng : null,
        accuracyM: state.accuracyM,
        status: state.locationStatus,
        followUser: state.followUser,
        userPanned: state.userPanned
      };
      window.__SHEDS_CHANNELS__ = state.lastChannels || null;
      window.__SHEDS_RECENTER_POLICY__ = {
        allowed: ["locate", "recenter", "goto-plan", "initial-locate-when-appropriate"],
        never: ["weather-load", "model-recalc", "date-change", "panel-open-close", "resize-invalidateSize", "delayed-timers", "rerender"]
      };
    } catch (e) { /* */ }
  }

  /**
   * Canonical selectedLocation SOT.
   * @param {{lat:number,lng:number,displayName?:string,source:string,updatedAt?:string}} loc
   */
  function setSelectedLocation(loc) {
    if (!loc || !isFinite(loc.lat) || !isFinite(loc.lng)) return;
    state.selectedLocation = {
      lat: loc.lat,
      lng: loc.lng,
      displayName: loc.displayName || null,
      source: loc.source || "map",
      updatedAt: loc.updatedAt || new Date().toISOString()
    };
    publishLocationDebug();
  }

  function selectedLatLng() {
    if (state.selectedLocation) {
      return { lat: state.selectedLocation.lat, lng: state.selectedLocation.lng };
    }
    if (state.userLatLng) {
      return { lat: state.userLatLng.lat, lng: state.userLatLng.lng };
    }
    if (map) {
      var c = map.getCenter();
      if (c) return { lat: c.lat, lng: c.lng };
    }
    return null;
  }

  function searchRadiusM() {
    if (SearchArea && SearchArea.radiusMForKey) {
      return SearchArea.radiusMForKey(state.searchRadiusKey || SEARCH_RADIUS_KEY);
    }
    var mapR = { small: 400, medium: 600, large: 1000 };
    return mapR[state.searchRadiusKey] || 600;
  }

  function setSearchLocation(lat, lng, source, opts) {
    opts = opts || {};
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var loc = SearchArea
      ? SearchArea.createSearchLocation(lat, lng, source || "map-tap")
      : { lat: lat, lng: lng, source: source || "map-tap", kind: "search_location", updatedAt: new Date().toISOString() };
    state.searchLocation = loc;
    state.lastSearchSnapshot = { lat: loc.lat, lng: loc.lng, updatedAt: loc.updatedAt };
    if (!opts.keepArea) {
      state.activeSearchAreaId = null;
      state.activeSearchAreaName = null;
    }
    drawSearchOnMap();
    syncSearchPrompt();
    scheduleRecompute(80);
    return loc;
  }

  function clearSearchLocation() {
    state.searchLocation = null;
    state.activeSearchAreaId = null;
    state.activeSearchAreaName = null;
    drawSearchOnMap();
    syncSearchPrompt();
    scheduleRecompute(80);
  }

  function openSavedSearchArea(id) {
    if (!AreaStore) return;
    var area = AreaStore.getById(id);
    if (!area || !area.center) return;
    state.activeSearchAreaId = area.id;
    state.activeSearchAreaName = area.name;
    if (area.radiusKey) state.searchRadiusKey = area.radiusKey;
    if ($("search-radius")) $("search-radius").value = state.searchRadiusKey;
    if ($("search-radius-tools")) $("search-radius-tools").value = state.searchRadiusKey;
    setSearchLocation(area.center.lat, area.center.lng, "saved-area", { keepArea: true });
    if (area.mapView && map) {
      map.setView([area.mapView.lat, area.mapView.lng], area.mapView.zoom || map.getZoom(), { animate: false });
    } else if (map) {
      map.setView([area.center.lat, area.center.lng], Math.max(map.getZoom(), 13), { animate: false });
    }
    refreshSglOverlay();
    scheduleRecompute(100);
  }

  function promptSaveSearchArea() {
    if (!state.searchLocation) {
      alert("Set a SEARCH location on the map first (tap the area to analyze).");
      return;
    }
    var pack = packForSearch();
    var meta = $("save-area-meta");
    if (meta) {
      meta.textContent = "Center " + state.searchLocation.lat.toFixed(4) + ", " +
        state.searchLocation.lng.toFixed(4) + " · ~" + searchRadiusM() + " m · GIS: " +
        (pack ? ("available (" + pack.packId + ")") : "unavailable for this SEARCH");
    }
    if ($("save-area-name")) $("save-area-name").value = state.activeSearchAreaName || "";
    if ($("save-area-notes")) $("save-area-notes").value = "";
    openSheet($("sheet-save-area"));
  }

  function confirmSaveSearchArea() {
    if (!AreaStore || !state.searchLocation) return;
    var name = $("save-area-name") ? $("save-area-name").value.trim() : "";
    if (!name) {
      alert("Name required.");
      return;
    }
    var pack = packForSearch();
    var view = map ? { lat: map.getCenter().lat, lng: map.getCenter().lng, zoom: map.getZoom() } : null;
    var res = AreaStore.create(AreaStore.fromSearchState({
      name: name,
      lat: state.searchLocation.lat,
      lng: state.searchLocation.lng,
      radiusKey: state.searchRadiusKey,
      radiusM: searchRadiusM(),
      mapView: view,
      notes: $("save-area-notes") ? $("save-area-notes").value.trim() : "",
      gisPackId: pack ? pack.packId : null,
      gisStatus: pack ? "available" : "unavailable"
    }));
    if (!res.ok) {
      alert(res.error || "Could not save.");
      return;
    }
    state.activeSearchAreaId = res.area.id;
    state.activeSearchAreaName = res.area.name;
    closeSheetQuiet($("sheet-save-area"));
  }

  function refreshAreasList() {
    if (!AreaStore || !FieldUi) return;
    var areas = AreaStore.list({ includeArchived: true });
    FieldUi.renderAreasList($("areas-list"), areas, {
      open: function (id) {
        openSavedSearchArea(id);
        closeSheetQuiet($("sheet-areas"));
      },
      rename: function (id) {
        var a = AreaStore.getById(id);
        var n = prompt("Rename Search Area", a ? a.name : "");
        if (n == null) return;
        AreaStore.rename(id, n);
        refreshAreasList();
      },
      archive: function (id) {
        AreaStore.archive(id);
        refreshAreasList();
      },
      unarchive: function (id) {
        AreaStore.unarchive(id);
        refreshAreasList();
      },
      delete: function (id) {
        var a = AreaStore.getById(id);
        if (!a) return;
        if (!confirm('Delete Search Area "' + a.name + '"? Observations and sessions are kept.')) return;
        AreaStore.remove(id);
        if (state.activeSearchAreaId === id) {
          state.activeSearchAreaId = null;
          state.activeSearchAreaName = null;
        }
        refreshAreasList();
      }
    });
  }

  function openFieldPlanSheet() {
    if (!FieldPlan || !FieldUi) return;
    var area = activeAreaRecord();
    var ch = evaluateChannels(state.lastPlan || null);
    var obsIn = [];
    if (Store.listForSearchArea && area) {
      obsIn = Store.listForSearchArea(area);
    }
    var inspect = null;
    if (state.lastPlan && state.lastPlan.ok && state.lastPlan.recommendation) {
      inspect = {
        summary: state.lastPlan.recommendation.summary || state.lastPlan.recommendation.label,
        label: state.lastPlan.recommendation.label,
        lat: state.lastPlan.recommendation.lat,
        lng: state.lastPlan.recommendation.lng
      };
    }
    var plan = FieldPlan.build({
      area: area,
      timing: ch && ch.timing,
      habitat: ch && ch.habitat,
      searchability: ch && ch.searchability,
      evidenceSupport: ch && ch.confidence,
      observationsInArea: obsIn,
      inspectSuggestion: inspect,
      includeObservationsInHabitat: !!(state.prefs && state.prefs.includeObservationsInHabitat),
      offline: !!(state.offlineForced || (typeof navigator !== "undefined" && navigator.onLine === false)),
      weatherAvailable: !!(state.weather && state.weatherStatus === "ready"),
      userNotes: area && area.notes
    });
    FieldUi.renderFieldPlan($("field-plan-body"), plan);
    openSheet($("sheet-field-plan"));
  }

  /** GPS / weather / date must not mutate SEARCH LOCATION. */
  function preserveSearchAcrossSideEffects() {
    if (!state.lastSearchSnapshot || !state.searchLocation) return;
    if (
      state.searchLocation.lat !== state.lastSearchSnapshot.lat ||
      state.searchLocation.lng !== state.lastSearchSnapshot.lng
    ) {
      state.searchLocation.lat = state.lastSearchSnapshot.lat;
      state.searchLocation.lng = state.lastSearchSnapshot.lng;
      state.searchLocation.updatedAt = state.lastSearchSnapshot.updatedAt;
      drawSearchOnMap();
    }
  }

  function syncSearchPrompt() {
    var prompt = $("search-prompt");
    var textEl = $("search-prompt-text");
    var btnYou = $("btn-analyze-you");
    if (!prompt) return;
    /* Inspect owns map taps until Done — do not compete with SEARCH copy. */
    if (state.inspectArmed || state.inspectLatLng) {
      prompt.setAttribute("hidden", "");
      return;
    }
    var hasSearch = !!state.searchLocation;
    var needs = SearchArea
      ? SearchArea.needsSearchPrompt(state.accuracyM, hasSearch)
      : !hasSearch;
    if (needs) {
      prompt.removeAttribute("hidden");
      if (textEl) {
        textEl.textContent = SearchArea
          ? SearchArea.promptText(state.accuracyM)
          : "Tap the area you want to analyze.";
      }
    } else if (hasSearch) {
      prompt.removeAttribute("hidden");
      if (textEl) {
        textEl.textContent =
          "SEARCH set · area ~" + searchRadiusM() + " m — tap map to move · notes via +";
      }
    } else {
      prompt.removeAttribute("hidden");
      if (textEl) textEl.textContent = "Tap the area you want to analyze.";
    }
    if (btnYou) {
      var ok = SearchArea
        ? SearchArea.canAnalyzeAtYou(state.accuracyM)
        : state.accuracyM != null && state.accuracyM <= SEARCH_YOU_ACCURACY_MAX_M;
      if (ok && state.userLatLng && !hasSearch) btnYou.removeAttribute("hidden");
      else btnYou.setAttribute("hidden", "");
    }
    var rad = $("search-radius");
    var radTools = $("search-radius-tools");
    if (rad) rad.value = state.searchRadiusKey || "medium";
    if (radTools) radTools.value = state.searchRadiusKey || "medium";
  }

  function drawSearchOnMap() {
    if (!map) return;
    if (!searchLayer) {
      searchLayer = L.layerGroup().addTo(map);
    }
    searchLayer.clearLayers();
    state.searchMarker = null;
    state.searchAreaCircle = null;
    if (!state.searchLocation) return;
    var ll = L.latLng(state.searchLocation.lat, state.searchLocation.lng);
    state.searchAreaCircle = L.circle(ll, {
      radius: searchRadiusM(),
      color: "#5ec8e8",
      weight: 2,
      dashArray: "2 8",
      fillColor: "#5ec8e8",
      fillOpacity: 0.05,
      interactive: false,
      className: "sheds-search-area-ring"
    }).addTo(searchLayer);
    state.searchMarker = L.marker(ll, {
      icon: L.divIcon({
        className: "sheds-search-loc",
        html:
          "<span class=\"sheds-search-loc__mark\" title=\"Search location\"></span>" +
          "<span class=\"sheds-search-loc__label\">SEARCH</span>",
        iconSize: [44, 40],
        iconAnchor: [22, 18]
      }),
      keyboard: false,
      zIndexOffset: 450
    })
      .bindTooltip("SEARCH — analysis center (not YOU)", {
        permanent: true,
        direction: "right",
        offset: [12, 0],
        className: "sheds-map-tip sheds-map-tip--search"
      })
      .addTo(searchLayer);
  }

  function ensureGisPacks() {
    if (!GisPack) return Promise.resolve(null);
    if (state.gisPacks.length) {
      return Promise.resolve(state.activeGisPack || GisPack.findCoveringPack(state.gisPacks, 0, 0));
    }
    state.gisLoadStatus = "loading";
    var entries = GisPack.listBundled();
    return Promise.all(
      entries.map(function (e) {
        return GisPack.loadPack(e).catch(function () {
          return GisPack.loadPack(e, { preferCacheOnly: true });
        });
      })
    ).then(function (packs) {
      state.gisPacks = packs.filter(Boolean);
      state.gisLoadStatus = state.gisPacks.length ? "ready" : "unavailable";
      return state.gisPacks[0] || null;
    });
  }

  function packForSearch() {
    if (!GisPack || !state.searchLocation) return null;
    var pack = GisPack.findCoveringPack(state.gisPacks, state.searchLocation.lat, state.searchLocation.lng);
    state.activeGisPack = pack;
    return pack;
  }

  function refreshSglOverlay() {
    if (!map || !SglOverlay) return;
    if (!sglLayerGroup) sglLayerGroup = L.layerGroup().addTo(map);
    sglLayerGroup.clearLayers();
    if (!state.sglVisible) return;
    var b;
    if (state.searchLocation) {
      var r = searchRadiusM();
      var latM = 111320;
      var lonM = 111320 * Math.cos((state.searchLocation.lat * Math.PI) / 180);
      b = {
        west: state.searchLocation.lng - r / lonM,
        east: state.searchLocation.lng + r / lonM,
        south: state.searchLocation.lat - r / latM,
        north: state.searchLocation.lat + r / latM
      };
    } else if (map) {
      var mb = map.getBounds();
      b = { west: mb.getWest(), south: mb.getSouth(), east: mb.getEast(), north: mb.getNorth() };
    } else return;
    SglOverlay.fetchSgl(b).then(function (res) {
      if (!state.sglVisible || !sglLayerGroup) return;
      sglLayerGroup.clearLayers();
      if (!res || !res.geojson || res.unavailable) {
        setModelCoverageNote(
          (SglOverlay.LABEL || "State Game Lands") + " — boundaries unavailable right now."
        );
        return;
      }
      L.geoJSON(res.geojson, {
        style: {
          color: "#c4a574",
          weight: 1.5,
          dashArray: "4 6",
          fillColor: "#c4a574",
          fillOpacity: 0.06
        },
        onEachFeature: function (feat, layer) {
          layer.bindTooltip(SglOverlay.LABEL, { sticky: true, className: "sheds-map-tip" });
        }
      }).addTo(sglLayerGroup);
    });
  }

  /** Explicit recenter only — never from weather/model/date/panel/resize timers. */
  function recenterToUser(opts) {
    opts = opts || {};
    if (!map || !state.userLatLng) return false;
    state.followUser = true;
    state.userPanned = false;
    var z = opts.zoom != null ? opts.zoom : Math.max(map.getZoom(), 13);
    map.setView(state.userLatLng, z, {
      animate: !document.documentElement.classList.contains("reduced-motion")
    });
    syncRecenterBtn();
    return true;
  }

  /**
   * USER LOCATION marker only — never used for search target / map center.
   * Approximate GPS uses a hollow ring + honest tooltip (not a precise “you are here” pin).
   */
  function upsertUserMarker(ll, accuracyM, headingDeg) {
    if (!map || !ll) return;
    var approximate =
      accuracyM != null && isFinite(accuracyM) && accuracyM > GPS_APPROX_M;
    state.locationKind = approximate
      ? LOCATION_KIND.USER_APPROXIMATE
      : LOCATION_KIND.USER_GPS;
    var fill = approximate ? "#8ec0ff" : "#f5f8f4";
    var stroke = approximate ? "#8ec0ff" : "#d8ec5c";
    var tip = approximate
      ? "YOU · approximate (±" + Math.round(accuracyM) + " m) — not a search target"
      : "YOU — your location (not a search target)";
    if (!userMarker) {
      userMarker = L.circleMarker(ll, {
        radius: approximate ? 9 : 8,
        color: stroke,
        weight: 3,
        fillColor: fill,
        fillOpacity: approximate ? 0.25 : 0.95,
        className: "sheds-user-marker" + (approximate ? " sheds-user-marker--approx" : ""),
        pane: "markerPane"
      }).addTo(map);
      userMarker.bindTooltip(tip, {
        permanent: true,
        direction: "right",
        offset: [10, 0],
        className: "sheds-map-tip sheds-map-tip--you"
      });
    } else {
      userMarker.setLatLng(ll);
      userMarker.setStyle({
        radius: approximate ? 8 : 7,
        color: stroke,
        fillColor: fill,
        fillOpacity: approximate ? 0.25 : 0.95,
        className: "sheds-user-marker" + (approximate ? " sheds-user-marker--approx" : "")
      });
      userMarker.setTooltipContent(tip);
    }
    if (accuracyM != null && isFinite(accuracyM) && accuracyM > 0 && accuracyM < 5000) {
      if (!accuracyCircle) {
        accuracyCircle = L.circle(ll, {
          radius: accuracyM,
          color: "#8ec0ff",
          weight: 1.5,
          dashArray: "4 6",
          fillColor: "#8ec0ff",
          fillOpacity: 0.04,
          interactive: false,
          className: "sheds-user-accuracy"
        }).addTo(map);
      } else {
        accuracyCircle.setLatLng(ll);
        accuracyCircle.setRadius(accuracyM);
      }
    } else if (accuracyCircle) {
      map.removeLayer(accuracyCircle);
      accuracyCircle = null;
    }
    if (headingLine) {
      map.removeLayer(headingLine);
      headingLine = null;
    }
    if (headingDeg != null && isFinite(headingDeg) && state.userLatLng && !approximate) {
      var rad = (headingDeg * Math.PI) / 180;
      var len = 0.00045;
      var tipPt = L.latLng(
        ll.lat + Math.cos(rad) * len,
        ll.lng + (Math.sin(rad) * len) / Math.cos((ll.lat * Math.PI) / 180)
      );
      headingLine = L.polyline([ll, tipPt], {
        color: "#8ec0ff",
        weight: 2,
        opacity: 0.85,
        interactive: false,
        className: "sheds-user-heading"
      }).addTo(map);
    }
    publishLocationDebug();
  }

  /** Apply GPS only when movement exceeds threshold (or forced). Prevents oscillation. */
  function applyUserPosition(ll, accuracyM, headingDeg, opts) {
    opts = opts || {};
    if (
      !opts.force &&
      state.userLatLng &&
      metersBetween(state.userLatLng, ll) < GPS_MOVE_MIN_M &&
      state.accuracyM != null &&
      accuracyM != null &&
      Math.abs(state.accuracyM - accuracyM) < 15
    ) {
      return false;
    }
    state.userLatLng = ll;
    state.accuracyM = accuracyM;
    if (headingDeg != null && isFinite(headingDeg)) state.headingDeg = headingDeg;
    setSelectedLocation({
      lat: ll.lat,
      lng: ll.lng,
      source: opts.source || "geolocation",
      displayName: opts.displayName || null,
      updatedAt: new Date().toISOString()
    });
    upsertUserMarker(ll, accuracyM, state.headingDeg);
    // Phase 2: YOU updates never move SEARCH LOCATION.
    preserveSearchAcrossSideEffects();
    syncSearchPrompt();
    return true;
  }

  function setMapLoading(done) {
    var el = $("map-loading");
    var shell = $("sheds-map-shell");
    if (el) {
      if (done) {
        el.classList.add("is-done");
        el.setAttribute("hidden", "");
      } else {
        el.classList.remove("is-done");
        el.removeAttribute("hidden");
      }
    }
    if (shell) shell.setAttribute("aria-busy", done ? "false" : "true");
  }

  function syncOfflineBanner() {
    var el = $("map-offline");
    if (!el) return;
    var offline = navigator.onLine === false;
    var forced = !!state.offlineForced;
    if (offline || forced) {
      el.removeAttribute("hidden");
      el.textContent = (Ux && Ux.EMPTY && Ux.EMPTY.NO_NETWORK) ||
        "No network. Live conditions unavailable. Your saved area and field records still work.";
      if (forced && !offline) {
        el.textContent = "Limited-data mode on. Live conditions may be unavailable; saved area and field records still work.";
      }
    } else {
      el.setAttribute("hidden", "");
    }
  }

  function syncSessionStrip() {
    var strip = $("session-strip");
    var meta = $("session-strip-meta");
    var stateEl = $("session-strip-state");
    if (!strip) return;
    if (!state.tracking) {
      strip.setAttribute("hidden", "");
      document.documentElement.classList.remove("sheds-session-active");
      return;
    }
    strip.removeAttribute("hidden");
    document.documentElement.classList.add("sheds-session-active");
    var session = state.activeSessionId && Sessions && Sessions.getSession
      ? Sessions.getSession(state.activeSessionId)
      : null;
    if (!session && Sessions && Sessions.getActiveSession) session = Sessions.getActiveSession();
    var obsN = 0;
    if (session && Store) {
      var sid = session.id;
      obsN = Store.list().filter(function (o) {
        return o && o.sessionId === sid;
      }).length;
    }
    var elapsed = "";
    if (session && session.startedAt) {
      var ms = Date.now() - Date.parse(session.startedAt);
      if (FieldUi && FieldUi.formatDuration) elapsed = FieldUi.formatDuration(ms);
      else elapsed = Math.max(0, Math.round(ms / 60000)) + " m";
    }
    if (stateEl) stateEl.textContent = "Search active";
    if (meta) {
      meta.textContent = [elapsed, obsN ? (obsN + " note" + (obsN === 1 ? "" : "s")) : "0 notes"]
        .filter(Boolean).join(" · ");
    }
  }

  function initFirstRunCoach() {
    var coach = $("first-run-coach");
    if (!coach || !Ux) return;
    if (Ux.shouldShowCoach()) {
      coach.removeAttribute("hidden");
    } else {
      coach.setAttribute("hidden", "");
    }
    var btn = $("btn-coach-dismiss");
    if (btn && !btn._shedsBound) {
      btn._shedsBound = true;
      btn.addEventListener("click", function () {
        Ux.dismissCoach();
        coach.setAttribute("hidden", "");
      });
    }
  }

  function toggleMapLegend() {
    var legend = $("map-marker-legend");
    var btn = $("btn-map-legend");
    if (!legend) return;
    var open = legend.hasAttribute("hidden");
    if (open) {
      legend.removeAttribute("hidden");
      if (btn) btn.setAttribute("aria-expanded", "true");
    } else {
      legend.setAttribute("hidden", "");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
  }

  function setTileStatus(status) {
    var el = $("map-tile-status");
    if (!el) return;
    state.tileStatus = status || null;
    if (!status) {
      el.setAttribute("hidden", "");
      el.textContent = "";
      return;
    }
    if (status.degraded) {
      el.removeAttribute("hidden");
      el.setAttribute("data-level", "error");
      el.textContent =
        "Map tiles aren’t loading from " +
        (status.providerLabel || "the basemap provider") +
        ". Check your connection, then pan or zoom to retry. Gray gaps mean the tile request failed — not missing terrain.";
      return;
    }
    if (status.struggling) {
      el.removeAttribute("hidden");
      el.setAttribute("data-level", "warn");
      el.textContent =
        "Some map tiles are slow or failing. Retrying automatically…";
      return;
    }
    el.setAttribute("hidden", "");
    el.textContent = "";
  }

  function invalidateMapSize() {
    if (!map) return;
    setTimeout(function () {
      try { map.invalidateSize({ animate: false }); } catch (e) { /* */ }
    }, 40);
    setTimeout(function () {
      try { map.invalidateSize({ animate: false }); } catch (e) { /* */ }
    }, 220);
  }

  function forceMapLayout(opts) {
    if (!map) return;
    opts = opts || {};
    try {
      // Phase 1: invalidateSize without resetView — never recenter from layout/timers.
      map.invalidateSize({ animate: false, pan: false });
      if (opts.resetView === true && opts.allowSetView === true) {
        var c = map.getCenter();
        var z = map.getZoom();
        if (c) map.setView(c, z, { animate: false });
      }
    } catch (e) { /* */ }
  }

  function initMap() {
    map = L.map("sheds-map", {
      zoomControl: false,
      attributionControl: true,
      maxZoom: 17,
      minZoom: 3,
      fadeAnimation: false,
      zoomAnimation: !!(window.matchMedia && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    });
    try {
      window.__SHEDS_MAP__ = map;
    } catch (eMap) { /* */ }
    // Zoom lives in the labeled field rail — avoid a second unexplained Leaflet stack.
    if (map.attributionControl && map.attributionControl.setPosition) {
      map.attributionControl.setPosition("bottomleft");
    }

    var Tiles = window.WaypointShedsTiles;
    if (!Tiles || !Tiles.createBasemaps) {
      throw new Error("WaypointShedsTiles missing — load sheds-tile-provider.js before sheds-map-app.js");
    }
    basemapsBundle = Tiles.createBasemaps(L);
    ["street", "topo", "satellite"].forEach(function (id) {
      var layer = basemapsBundle.byId[id];
      if (layer) Tiles.attachReliability(layer, { onStatus: setTileStatus });
    });
    /* Hybrid group: reliability on imagery only — label-tile failures must not
       mark the whole basemap degraded while imagery still works. */
    try {
      if (basemapsBundle.hybridImagery) {
        Tiles.attachReliability(basemapsBundle.hybridImagery, { onStatus: setTileStatus });
      } else if (basemapsBundle.hybrid && basemapsBundle.hybrid.eachLayer) {
        var first = true;
        basemapsBundle.hybrid.eachLayer(function (lyr) {
          if (first && lyr && lyr.on) {
            Tiles.attachReliability(lyr, { onStatus: setTileStatus });
            first = false;
          }
        });
      }
    } catch (e) { /* */ }

    var initialBasemap = Tiles.resolveInitialBasemapId(basemapsBundle);
    state.basemapId = Tiles.applyBasemap(map, basemapsBundle, initialBasemap) || "street";
    syncBasemapSelect();

    basemapLayersControl = L.control.layers(basemapsBundle.baseLayers, null, {
      position: "topright",
      collapsed: true
    }).addTo(map);
    map.on("baselayerchange", function (ev) {
      setTileStatus(null);
      var nextId = null;
      var ids = basemapsBundle.ids || [];
      for (var i = 0; i < ids.length; i += 1) {
        if (basemapsBundle.byId[ids[i]] === ev.layer) {
          nextId = ids[i];
          break;
        }
      }
      if (nextId) {
        state.basemapId = nextId;
        Tiles.saveBasemapId(nextId);
        syncBasemapSelect();
      }
    });

    var firstTile = false;
    function afterBasemapSettles() {
      forceMapLayout({ resetView: false });
      try {
        var active = basemapsBundle.byId[state.basemapId];
        if (active && typeof active.redraw === "function" && map.hasLayer(active)) active.redraw();
      } catch (e) { /* */ }
    }
    function bindFirstLoad(layer) {
      if (!layer || !layer.on) return;
      layer.on("load", function () {
        if (!firstTile) {
          firstTile = true;
          setMapLoading(true);
          afterBasemapSettles();
        }
      });
    }
    bindFirstLoad(basemapsBundle.byId[state.basemapId]);
    if (state.basemapId === "hybrid" && basemapsBundle.hybrid && basemapsBundle.hybrid.eachLayer) {
      basemapsBundle.hybrid.eachLayer(bindFirstLoad);
    }
    // Safety: clear loading even if tiles are cached and 'load' is quiet
    setTimeout(function () {
      if (!firstTile) {
        firstTile = true;
        setMapLoading(true);
        afterBasemapSettles();
      }
    }, 2500);

    obsLayer = L.layerGroup().addTo(map);
    scoutLayer = L.layerGroup().addTo(map);
    coverageLayer = L.layerGroup().addTo(map);
    trackLayer = L.layerGroup().addTo(map);
    planLayer = L.layerGroup().addTo(map);

    var saved = Store.loadMapView();
    var start = saved
      ? [saved.lat, saved.lng, saved.zoom]
      : [NEUTRAL.lat, NEUTRAL.lng, NEUTRAL.zoom];
    // Size sync BEFORE first view so tile pixel origin matches the full-screen shell
    map.invalidateSize({ animate: false });
    map.setView([start[0], start[1]], start[2], { animate: false });
    if (saved) setLocStatus("last", "saved view");
    else setLocStatus("neutral");

    // Heat layer is created lazily on first recompute so basemap tiles win the first paint
    heatLayer = null;

    map.whenReady(function () {
      afterBasemapSettles();
      invalidateMapSize();
    });
    // Phase 1: no delayed setView/layout storms — one settle + size sync only.
    setTimeout(function () { forceMapLayout({ resetView: false }); setMapLoading(true); }, 400);

    if (typeof ResizeObserver === "function") {
      var shellEl = document.getElementById("sheds-map-shell");
      if (shellEl) {
        var resizeTimer = null;
        var ro = new ResizeObserver(function () {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(function () { forceMapLayout({ resetView: false }); }, 80);
        });
        ro.observe(shellEl);
      }
    }

    map.on("dragstart", function () {
      state.followUser = false;
      state.userPanned = true;
      syncRecenterBtn();
    });
    map.on("zoomstart", function () {
      // User zoom preserves viewport intent — do not auto-follow after.
      if (!state.followUser) state.userPanned = true;
    });

    map.on("moveend", function () {
      Store.saveMapView({
        lat: map.getCenter().lat,
        lng: map.getCenter().lng,
        zoom: map.getZoom()
      });
      scheduleRecompute(450);
      scheduleSearchAreas(500);
    });

    map.on("click", function (e) {
      if (document.querySelector(".sheds-sheet.is-open")) return;
      var now = Date.now();
      /* SEARCH placement uses a 450ms debounce against accidental double-taps.
         Measure/Inspect need quick successive vertices — only guard true doubles. */
      var minGap = state.measureActive || state.inspectArmed ? 80 : 450;
      if (now - state.lastClickAt < minGap) return;
      state.lastClickAt = now;
      if (state.measureActive) {
        addMeasurePoint(e.latlng);
        return;
      }
      if (state.inspectArmed) {
        showInspectAt(e.latlng);
        return;
      }
      // Phase 2: map tap sets SEARCH LOCATION — observations via Add note FAB.
      setSearchLocation(e.latlng.lat, e.latlng.lng, "map-tap");
      if (map.getZoom() < 12) {
        state.followUser = false;
        map.setView(e.latlng, 13, { animate: !document.documentElement.classList.contains("reduced-motion") });
      }
    });

    map.whenReady(function () {
      document.getElementById("sheds-map-shell").removeAttribute("aria-busy");
      scheduleRecompute(200);
      invalidateMapSize();
      setTimeout(invalidateMapSize, 400);
      setTimeout(invalidateMapSize, 1200);
    });

    window.addEventListener("resize", function () {
      forceMapLayout();
      invalidateMapSize();
    });
    window.addEventListener("orientationchange", function () {
      setTimeout(forceMapLayout, 200);
      invalidateMapSize();
    });
  }

  function markerHtml(type) {
    var meta = Store.typeMeta(type);
    var letter = (meta.marker || "o").charAt(0).toUpperCase();
    return "<span class=\"sheds-marker sheds-marker--" + meta.marker + "\" title=\"" + meta.label + "\">" + letter + "</span>";
  }

  function refreshObservations() {
    obsLayer.clearLayers();
    if (!state.prefs.obsVisible) return;
    var all = Store.list();
    var filter = state.filterTypes;
    all.forEach(function (obs) {
      if (filter && filter.size && !filter.has(obs.type)) return;
      var icon = L.divIcon({
        className: "sheds-div-icon",
        html: markerHtml(obs.type),
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      var m = L.marker([obs.location.lat, obs.location.lng], { icon: icon });
      m.on("click", function (ev) {
        L.DomEvent.stopPropagation(ev);
        openViewObservation(obs.id);
      });
      obsLayer.addLayer(m);
    });
    updateObsCount(all.length);
  }

  function updateObsCount(n) {
    if (els.obsCount) els.obsCount.textContent = String(n) + " private observation" + (n === 1 ? "" : "s");
  }

  function scoutMarkHtml(spot, opts) {
    opts = opts || {};
    var status = (spot && spot.status) || "Plan";
    var classes = "sheds-scout-mark";
    if (opts.open) classes += " is-open";
    if (opts.selected) classes += " is-selected";
    var mark = "<span class=\"" + classes +
      "\" data-status=\"" + escapeHtml(status) + "\" title=\"" +
      escapeHtml((spot && spot.name) || "Scout Spot") + "\"></span>";
    if (opts.order) {
      return "<span class=\"sheds-scout-icon-wrap\">" + mark +
        "<span class=\"sheds-scout-order\">" + escapeHtml(String(opts.order)) + "</span></span>";
    }
    return mark;
  }

  function closeScoutHud() {
    state.scoutSpotId = null;
    var hud = $("scout-hud");
    if (hud) hud.setAttribute("hidden", "");
    var shell = document.getElementById("sheds-map-shell");
    if (shell) shell.classList.remove("is-scouting");
    if (scoutLayer) refreshScoutSpots();
    syncSearchPrompt();
  }

  function formatScoutTerrainBody(spot) {
    var t = (spot && spot.terrain) || {};
    var lines = [];
    if (t.available && t.searchPriority) {
      lines.push("Search priority: " + t.searchPriority);
    } else {
      lines.push("Terrain intelligence unavailable at save");
      if (t.status && t.status !== "unavailable") lines.push("Status: " + t.status);
    }
    lines.push("");
    lines.push("Terrain");
    if (t.featureLabel) lines.push(String(t.featureLabel).replace(/\.$/, ""));
    var bits = [];
    if (typeof t.slopeDeg === "number") bits.push("slope " + t.slopeDeg + "°");
    if (t.aspectCardinal) bits.push(t.aspectCardinal + "-facing");
    if (typeof t.elevM === "number") {
      bits.push("~" + Math.round(t.elevM) + " m (" + Math.round(t.elevM * 3.28084) + " ft)");
    }
    if (bits.length) lines.push(bits.join(" · "));
    else if (!t.available) lines.push("No slope, aspect, or elevation was stored.");
    lines.push("");
    lines.push("Why");
    if (t.why && t.why.length) {
      t.why.forEach(function (w) { lines.push("• " + w); });
    } else {
      lines.push("• Terrain context was limited when this Scout Spot was saved.");
    }
    return lines.join("\n");
  }

  function formatWhen(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    try {
      return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    } catch (e) {
      return String(iso);
    }
  }

  function renderScoutHud(spot) {
    if (!spot) return;
    var nameEl = $("scout-name");
    var noteEl = $("scout-note");
    var body = $("scout-body");
    var savedWhen = $("scout-saved-when");
    var savedBody = $("scout-saved-body");
    var todayBody = $("scout-today-body");
    var fieldNote = $("scout-field-note");
    if (nameEl && document.activeElement !== nameEl) nameEl.value = spot.name || "";
    if (noteEl && document.activeElement !== noteEl) noteEl.value = spot.note || "";
    if (body) body.textContent = formatScoutTerrainBody(spot);
    document.querySelectorAll("[data-scout-status]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-scout-status") === spot.status ? "true" : "false");
    });
    if (ScoutStore) {
      var saved = ScoutStore.formatSavedContext(spot.savedToday);
      if (savedWhen) {
        savedWhen.textContent = saved.capturedAt ? ("Saved " + formatWhen(saved.capturedAt)) : "";
      }
      if (savedBody) {
        savedBody.textContent = saved.lines.concat(saved.disclaimer ? [saved.disclaimer] : []).join("\n");
      }
      var live = ScoutStore.formatLiveToday(state.lastHunt);
      if (todayBody) {
        todayBody.textContent = live.lines.concat(live.disclaimer ? [live.disclaimer] : []).join("\n");
      }
    }
    if (fieldNote) fieldNote.textContent = (ScoutStore && ScoutStore.FIELD_NOTE) ||
      "Use the terrain as a search guide, not evidence that sheds are present.";
  }

  function openScoutSpot(id) {
    if (!ScoutStore) return;
    var spot = ScoutStore.getById(id);
    if (!spot) return;
    stopMeasureMode();
    stopInspectMode();
    closeHuntPlanHud();
    stopHuntSelect({ silent: true });
    closeAllSheets();
    state.scoutSpotId = id;
    renderScoutHud(spot);
    var hud = $("scout-hud");
    if (hud) hud.removeAttribute("hidden");
    var shell = document.getElementById("sheds-map-shell");
    if (shell) shell.classList.add("is-scouting");
    var prompt = $("search-prompt");
    if (prompt) prompt.setAttribute("hidden", "");
    refreshScoutSpots();
    if (map && spot.location) {
      try {
        var z = map.getZoom();
        if (z < 12) map.setView([spot.location.lat, spot.location.lng], 13, { animate: false });
        else map.panTo([spot.location.lat, spot.location.lng], { animate: false });
      } catch (e) { /* */ }
    }
  }

  function refreshScoutSpots() {
    if (!scoutLayer) return;
    scoutLayer.clearLayers();
    if (!ScoutStore) return;
    var spots = ScoutStore.list();
    spots.forEach(function (spot) {
      if (!spot || !spot.location) return;
      var open = state.scoutSpotId === spot.id;
      var selected = state.huntSelecting && state.huntSelectIds.indexOf(spot.id) >= 0;
      var order = 0;
      if (state.huntPlanId && HuntPlans) {
        var openPlan = HuntPlans.getById(state.huntPlanId);
        if (openPlan && openPlan.scoutSpotIds) {
          var idx = openPlan.scoutSpotIds.indexOf(spot.id);
          if (idx >= 0) order = idx + 1;
        }
      }
      var icon = L.divIcon({
        className: "leaflet-div-icon sheds-scout-icon",
        html: scoutMarkHtml(spot, { open: open, selected: selected, order: order }),
        iconSize: order || open || selected ? [20, 20] : [16, 16],
        iconAnchor: order || open || selected ? [10, 10] : [8, 8]
      });
      var m = L.marker([spot.location.lat, spot.location.lng], {
        icon: icon,
        keyboard: true,
        title: (spot.name || "Scout Spot") + " · " + (spot.status || "Plan") +
          (order ? " · Hunt Plan " + order : ""),
        zIndexOffset: open || order ? 400 : (selected ? 280 : 120)
      });
      m.on("click", function (ev) {
        L.DomEvent.stopPropagation(ev);
        onScoutMarkerClick(spot.id);
      });
      scoutLayer.addLayer(m);
    });
    refreshScoutList();
  }

  function refreshScoutList() {
    var list = $("scout-spots-list");
    if (!list || !ScoutStore) return;
    var spots = ScoutStore.list();
    if (!spots.length) {
      list.innerHTML = "<li class=\"sheds-note\">No Scout Spots yet. Inspect a place, then Save Scout Spot.</li>";
      return;
    }
    list.innerHTML = spots.map(function (s) {
      var pri = s.terrain && s.terrain.searchPriority ? s.terrain.searchPriority : "unrated terrain";
      return "<li><button type=\"button\" class=\"sheds-btn\" data-open-scout=\"" +
        escapeHtml(s.id) + "\">" + escapeHtml(s.name) +
        " · " + escapeHtml(s.status) +
        " · " + escapeHtml(pri) + "</button></li>";
    }).join("");
    list.querySelectorAll("[data-open-scout]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeSheetQuiet($("sheet-scout-spots"));
        openScoutSpot(btn.getAttribute("data-open-scout"));
      });
    });
  }

  function saveScoutSpotFromInspect() {
    var statusEl = $("inspect-scout-status");
    function setMsg(text, show) {
      if (!statusEl) return;
      statusEl.textContent = text || "";
      statusEl.hidden = !show;
    }
    if (!ScoutStore || !state.inspectLatLng) {
      setMsg("Inspect a map location first.", true);
      return;
    }
    var priority = state.inspectPriority || buildInspectPriority();
    var hunt = state.lastHunt || refreshTodayHunt();
    var result = ScoutStore.create({
      location: { lat: state.inspectLatLng.lat, lng: state.inspectLatLng.lng },
      terrain: ScoutStore.terrainFromPriority(priority),
      savedToday: ScoutStore.snapshotFromHunt(hunt),
      status: "Plan"
    });
    if (!result.ok) {
      setMsg(result.error || "Could not save Scout Spot.", true);
      return;
    }
    setMsg("", false);
    refreshScoutSpots();
    openScoutSpot(result.spot.id);
  }

  function onScoutMarkerClick(id) {
    if (state.huntSelecting) {
      toggleHuntSelect(id);
      return;
    }
    if (state.huntPlanId && HuntPlans) {
      var plan = HuntPlans.getById(state.huntPlanId);
      if (plan && plan.scoutSpotIds.indexOf(id) >= 0) {
        var row = document.querySelector("[data-hunt-plan-spot=\"" + id + "\"]");
        if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
        return;
      }
    }
    openScoutSpot(id);
  }

  function syncHuntSelectHud() {
    var hud = $("hunt-select-hud");
    if (!hud) return;
    if (!state.huntSelecting) {
      hud.setAttribute("hidden", "");
      return;
    }
    hud.removeAttribute("hidden");
    var n = state.huntSelectIds.length;
    var count = $("hunt-select-count");
    if (count) {
      count.textContent = n + " Scout Spot" + (n === 1 ? "" : "s") + " selected";
    }
    var create = $("btn-hunt-select-create");
    if (create) create.disabled = n < 1;
  }

  function startHuntSelect(preselected) {
    if (!ScoutStore || !ScoutStore.list().length) {
      window.alert("Save a Scout Spot from Inspect first, then create a Hunt Plan.");
      return;
    }
    closeScoutHud();
    closeHuntPlanHud();
    stopInspectMode({ silent: true });
    stopMeasureMode();
    closeAllSheets();
    state.huntSelecting = true;
    state.huntSelectIds = Array.isArray(preselected) ? preselected.slice() : [];
    var prompt = $("search-prompt");
    if (prompt) prompt.setAttribute("hidden", "");
    syncHuntSelectHud();
    refreshScoutSpots();
  }

  function stopHuntSelect(opts) {
    opts = opts || {};
    if (!state.huntSelecting && !state.huntSelectIds.length) return;
    state.huntSelecting = false;
    state.huntSelectIds = [];
    syncHuntSelectHud();
    if (!opts.silent) refreshScoutSpots();
  }

  function toggleHuntSelect(id) {
    var ids = state.huntSelectIds.slice();
    var idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1);
    else {
      if (HuntPlans && ids.length >= HuntPlans.MAX_SPOTS_PER_PLAN) {
        window.alert("A Hunt Plan can include " + HuntPlans.MAX_SPOTS_PER_PLAN + " Scout Spots.");
        return;
      }
      ids.push(id);
    }
    state.huntSelectIds = ids;
    syncHuntSelectHud();
    refreshScoutSpots();
  }

  function promptNameHuntPlan(ids) {
    if (!ids || !ids.length) {
      window.alert("Select at least one Scout Spot.");
      return;
    }
    var input = $("hunt-plan-name-input");
    var meta = $("hunt-plan-name-meta");
    if (input) {
      input.value = HuntPlans ? HuntPlans.defaultName(ids) : "Hunt Plan";
    }
    if (meta) {
      meta.textContent = ids.length + " Scout Spot" + (ids.length === 1 ? "" : "s") +
        " · intended search sequence, not a route.";
    }
    state.pendingHuntPlanIds = ids.slice();
    closeAllSheets();
    openSheet($("sheet-hunt-plan-name"));
  }

  function saveNamedHuntPlan() {
    if (!HuntPlans) return;
    var ids = state.pendingHuntPlanIds || state.huntSelectIds || [];
    var nameEl = $("hunt-plan-name-input");
    var name = nameEl ? nameEl.value : "";
    var result = HuntPlans.create({ name: name, scoutSpotIds: ids });
    if (!result.ok) {
      window.alert(result.error || "Could not save Hunt Plan.");
      return;
    }
    state.pendingHuntPlanIds = null;
    stopHuntSelect({ silent: true });
    closeSheetQuiet($("sheet-hunt-plan-name"));
    openHuntPlan(result.plan.id);
  }

  function closeHuntPlanHud() {
    state.huntPlanId = null;
    var hud = $("hunt-plan-hud");
    if (hud) hud.setAttribute("hidden", "");
    var shell = document.getElementById("sheds-map-shell");
    if (shell) shell.classList.remove("is-hunting-plan");
    refreshScoutSpots();
  }

  function formatHuntPlanToday(plan) {
    if (!ScoutStore) {
      return {
        lines: ["Today’s Hunt is unavailable."],
        disclaimer: "Current conditions are live — not from when this Hunt Plan was created."
      };
    }
    var live = ScoutStore.formatLiveToday(state.lastHunt);
    var lines = (live.lines || []).slice();
    if (state.lastHunt && state.lastHunt.status === "need_location") {
      var loc = HuntPlans && HuntPlans.planLocation(plan, ScoutStore);
      if (loc && loc.disclaimer) lines.push(loc.disclaimer);
    }
    return {
      lines: lines,
      disclaimer: "Current conditions are live — not from when this Hunt Plan was created. They do not rewrite Scout Spot saved context."
    };
  }

  function renderHuntPlanHud(plan) {
    if (!plan || !HuntPlans) return;
    var nameEl = $("hunt-plan-name");
    var noteEl = $("hunt-plan-note");
    var countEl = $("hunt-plan-count");
    var list = $("hunt-plan-list");
    var distEl = $("hunt-plan-distance");
    var todayBody = $("hunt-plan-today-body");
    var fieldNote = $("hunt-plan-field-note");
    if (nameEl && document.activeElement !== nameEl) nameEl.value = plan.name || "";
    if (noteEl && document.activeElement !== noteEl) noteEl.value = plan.note || "";
    document.querySelectorAll("[data-hunt-plan-status]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-hunt-plan-status") === plan.status ? "true" : "false");
    });
    var entries = HuntPlans.resolveEntries(plan, ScoutStore);
    if (countEl) {
      countEl.textContent = entries.length
        ? entries.length + " Scout Spot" + (entries.length === 1 ? "" : "s") + " in intended search order"
        : "No Scout Spots remain in this Hunt Plan.";
    }
    if (list) {
      if (!entries.length) {
        list.innerHTML = "<li class=\"sheds-note\">Scout Spots from this plan were removed on this device. The plan remains; it does not invent replacements.</li>";
      } else {
        list.innerHTML = entries.map(function (entry) {
          var detail;
          if (entry.missing) {
            detail = "Scout Spot unavailable — this id is no longer on this device.";
          } else {
            var bits = [entry.status || "Plan"];
            if (entry.searchPriority) bits.push(entry.searchPriority);
            else bits.push("unrated terrain");
            if (entry.featureLabel) bits.push(String(entry.featureLabel).replace(/\.$/, ""));
            detail = bits.join(" · ");
          }
          var upDisabled = entry.index === 0 ? " disabled" : "";
          var downDisabled = entry.index === entries.length - 1 ? " disabled" : "";
          return "<li class=\"sheds-hunt-plan-row\" data-hunt-plan-spot=\"" + escapeHtml(entry.id) + "\">" +
            "<span class=\"sheds-hunt-plan-row__order\">" + entry.order + "</span>" +
            "<div class=\"sheds-hunt-plan-row__meta\">" +
            "<p class=\"sheds-hunt-plan-row__name\">" + escapeHtml(entry.name) + "</p>" +
            "<p class=\"sheds-hunt-plan-row__detail\">" + escapeHtml(detail) + "</p></div>" +
            "<div class=\"sheds-hunt-plan-row__moves\">" +
            "<button type=\"button\" class=\"sheds-btn\" data-hunt-move=\"up\" data-spot=\"" +
            escapeHtml(entry.id) + "\" aria-label=\"Move up in search order\"" + upDisabled + ">Up</button>" +
            "<button type=\"button\" class=\"sheds-btn\" data-hunt-move=\"down\" data-spot=\"" +
            escapeHtml(entry.id) + "\" aria-label=\"Move down in search order\"" + downDisabled + ">Down</button></div></li>";
        }).join("");
        list.querySelectorAll("[data-hunt-move]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            if (!state.huntPlanId) return;
            var dir = btn.getAttribute("data-hunt-move") === "up" ? -1 : 1;
            var result = HuntPlans.moveSpot(state.huntPlanId, btn.getAttribute("data-spot"), dir);
            if (result.ok && result.plan) {
              renderHuntPlanHud(result.plan);
              refreshScoutSpots();
            }
          });
        });
      }
    }
    if (distEl) {
      var locs = entries.filter(function (e) { return e.spot && e.spot.location; }).map(function (e) {
        return e.spot.location;
      });
      var seq = HuntPlans.sequenceDistance(locs);
      if (seq.totalLabel) {
        distEl.textContent = seq.sequenceLabel + ": " + seq.totalLabel +
          (seq.legs.length ? " · " + seq.legs.map(function (leg) {
            return (leg.fromIndex + 1) + "–" + (leg.toIndex + 1) + " " + leg.label;
          }).join(", ") : "") +
          ". Straight-line distance only — not hiking, driving, or trail distance.";
      } else {
        distEl.textContent = "Straight-line distance needs at least two Scout Spots with locations.";
      }
    }
    var today = formatHuntPlanToday(plan);
    if (todayBody) {
      todayBody.textContent = today.lines.concat(today.disclaimer ? [today.disclaimer] : []).join("\n");
    }
    if (fieldNote) fieldNote.textContent = HuntPlans.FIELD_NOTE;
  }

  function openHuntPlan(id) {
    if (!HuntPlans) return;
    var plan = HuntPlans.getById(id);
    if (!plan) return;
    stopHuntSelect({ silent: true });
    closeScoutHud();
    stopMeasureMode();
    stopInspectMode({ silent: true });
    closeAllSheets();
    state.huntPlanId = id;
    renderHuntPlanHud(plan);
    var hud = $("hunt-plan-hud");
    if (hud) {
      hud.removeAttribute("hidden");
      hud.scrollTop = 0;
    }
    var shell = document.getElementById("sheds-map-shell");
    if (shell) shell.classList.add("is-hunting-plan");
    var prompt = $("search-prompt");
    if (prompt) prompt.setAttribute("hidden", "");
    refreshScoutSpots();
    var first = null;
    plan.scoutSpotIds.some(function (sid) {
      var spot = ScoutStore && ScoutStore.getById(sid);
      if (spot && spot.location) {
        first = spot;
        return true;
      }
      return false;
    });
    if (map && first && first.location) {
      try {
        var z = map.getZoom();
        if (z < 12) map.setView([first.location.lat, first.location.lng], 13, { animate: false });
        else map.panTo([first.location.lat, first.location.lng], { animate: false });
      } catch (e) { /* */ }
    }
  }

  function refreshHuntPlanList() {
    var list = $("hunt-plans-list");
    if (!list || !HuntPlans) return;
    var plans = HuntPlans.list();
    if (!plans.length) {
      list.innerHTML = "<li class=\"sheds-note\">No Hunt Plans yet. Select Scout Spots, then Create Hunt Plan.</li>";
      return;
    }
    list.innerHTML = plans.map(function (p) {
      return "<li><button type=\"button\" class=\"sheds-btn\" data-open-hunt-plan=\"" +
        escapeHtml(p.id) + "\">" + escapeHtml(p.name) +
        " · " + escapeHtml(p.status) +
        " · " + p.scoutSpotIds.length + " Scout Spot" +
        (p.scoutSpotIds.length === 1 ? "" : "s") + "</button></li>";
    }).join("");
    list.querySelectorAll("[data-open-hunt-plan]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeSheetQuiet($("sheet-hunt-plans"));
        openHuntPlan(btn.getAttribute("data-open-hunt-plan"));
      });
    });
  }

  function addScoutToHuntPlan(spotId) {
    if (!HuntPlans || !spotId) return;
    var plans = HuntPlans.list();
    if (!plans.length) {
      promptNameHuntPlan([spotId]);
      return;
    }
    if (plans.length === 1) {
      var one = HuntPlans.addSpot(plans[0].id, spotId);
      if (!one.ok) {
        window.alert(one.error || "Could not add to Hunt Plan.");
        return;
      }
      closeScoutHud();
      openHuntPlan(plans[0].id);
      return;
    }
    var list = $("choose-hunt-plan-list");
    if (list) {
      list.innerHTML = plans.map(function (p) {
        return "<li><button type=\"button\" class=\"sheds-btn\" data-choose-hunt-plan=\"" +
          escapeHtml(p.id) + "\">" + escapeHtml(p.name) +
          " · " + escapeHtml(p.status) + "</button></li>";
      }).join("");
      list.querySelectorAll("[data-choose-hunt-plan]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var result = HuntPlans.addSpot(btn.getAttribute("data-choose-hunt-plan"), spotId);
          if (!result.ok) {
            window.alert(result.error || "Could not add to Hunt Plan.");
            return;
          }
          closeSheetQuiet($("sheet-choose-hunt-plan"));
          closeScoutHud();
          openHuntPlan(result.plan.id);
        });
      });
    }
    closeAllSheets();
    openSheet($("sheet-choose-hunt-plan"));
  }

  function scheduleRecompute(ms) {
    clearTimeout(state.recomputeTimer);
    state.recomputeTimer = setTimeout(recomputeHeat, ms || 300);
  }

  function scheduleSearchAreas(ms) {
    clearTimeout(state.searchAreasTimer);
    if (!state.searchAreasVisible) {
      if (searchAreasLayer) searchAreasLayer.setHeatVisible(false);
      syncSearchAreasLegend();
      return;
    }
    state.searchAreasTimer = setTimeout(recomputeSearchAreas, ms || 400);
  }

  function elevCacheKey(bounds) {
    return [
      bounds.getWest().toFixed(3),
      bounds.getSouth().toFixed(3),
      bounds.getEast().toFixed(3),
      bounds.getNorth().toFixed(3),
      GRID_ROWS,
      GRID_COLS
    ].join("|");
  }

  function fetchElevations(bounds) {
    var key = elevCacheKey(bounds);
    if (state.elevKey === key && state.elevCache) {
      return Promise.resolve(state.elevCache);
    }
    if (state.elevAbort) {
      try { state.elevAbort.abort(); } catch (e) { /* */ }
      state.elevAbort = null;
    }
    var ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    state.elevAbort = ac;
    var elevGen = ++state.elevFetchGen;
    var west = bounds.getWest();
    var east = bounds.getEast();
    var south = bounds.getSouth();
    var north = bounds.getNorth();
    var lats = [];
    var lngs = [];
    var r, c;
    for (r = 0; r < GRID_ROWS; r++) {
      for (c = 0; c < GRID_COLS; c++) {
        lats.push(north - (r + 0.5) * (north - south) / GRID_ROWS);
        lngs.push(west + (c + 0.5) * (east - west) / GRID_COLS);
      }
    }
    // Chunk Open-Meteo elevation requests
    var chunks = [];
    var size = 80;
    var i;
    for (i = 0; i < lats.length; i += size) {
      chunks.push({
        lat: lats.slice(i, i + size),
        lng: lngs.slice(i, i + size)
      });
    }
    setModelCoverageNote("Updating elevation samples…");
    return chunks.reduce(function (chain, ch) {
      return chain.then(function (acc) {
        if (ac && ac.signal && ac.signal.aborted) {
          return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }
        var url = "https://api.open-meteo.com/v1/elevation?latitude=" +
          ch.lat.map(function (n) { return n.toFixed(5); }).join(",") +
          "&longitude=" + ch.lng.map(function (n) { return n.toFixed(5); }).join(",");
        var opts = { credentials: "omit" };
        if (ac && ac.signal) opts.signal = ac.signal;
        return fetch(url, opts).then(function (res) {
          if (!res.ok) throw new Error("elevation " + res.status);
          return res.json();
        }).then(function (data) {
          var elev = data.elevation || [];
          return acc.concat(elev);
        });
      });
    }, Promise.resolve([])).then(function (allElev) {
      if (elevGen !== state.elevFetchGen) return null;
      if (state.elevAbort === ac) state.elevAbort = null;
      state.elevCache = allElev;
      state.elevKey = key;
      return allElev;
    }).catch(function (err) {
      if (elevGen !== state.elevFetchGen) return null;
      if (state.elevAbort === ac) state.elevAbort = null;
      if (err && err.name === "AbortError") return null;
      state.elevCache = null;
      state.elevKey = "";
      return null;
    });
  }

  function fetchSearchAreaElevations(bounds, rows, cols) {
    if (!SearchPriority || !SearchPriority.haloLatLngs) {
      return Promise.resolve(null);
    }
    var pts = SearchPriority.haloLatLngs(
      SearchPriority.clampSearchBounds({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        west: bounds.getWest(),
        east: bounds.getEast()
      }),
      rows,
      cols
    );
    if (state.searchAreasAbort) {
      try { state.searchAreasAbort.abort(); } catch (e) { /* */ }
      state.searchAreasAbort = null;
    }
    var ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    state.searchAreasAbort = ac;
    var gen = ++state.searchAreasFetchGen;
    var chunks = [];
    var size = 80;
    var i;
    for (i = 0; i < pts.lats.length; i += size) {
      chunks.push({
        lat: pts.lats.slice(i, i + size),
        lng: pts.lngs.slice(i, i + size)
      });
    }
    return chunks.reduce(function (chain, ch) {
      return chain.then(function (acc) {
        if (ac && ac.signal && ac.signal.aborted) {
          return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }
        var url = "https://api.open-meteo.com/v1/elevation?latitude=" +
          ch.lat.map(function (n) { return n.toFixed(5); }).join(",") +
          "&longitude=" + ch.lng.map(function (n) { return n.toFixed(5); }).join(",");
        var opts = { credentials: "omit" };
        if (ac && ac.signal) opts.signal = ac.signal;
        return fetch(url, opts).then(function (res) {
          if (!res.ok) throw new Error("elevation " + res.status);
          return res.json();
        }).then(function (data) {
          return acc.concat(data.elevation || []);
        });
      });
    }, Promise.resolve([])).then(function (allElev) {
      if (gen !== state.searchAreasFetchGen) return null;
      if (state.searchAreasAbort === ac) state.searchAreasAbort = null;
      return allElev;
    }).catch(function (err) {
      if (gen !== state.searchAreasFetchGen) return null;
      if (state.searchAreasAbort === ac) state.searchAreasAbort = null;
      if (err && err.name === "AbortError") return null;
      return { failed: true };
    });
  }

  function ensureSearchAreasLayer() {
    if (searchAreasLayer || !map || !Heat) return searchAreasLayer;
    searchAreasLayer = Heat.createHeatLayer(map, {
      opacity: 0.40,
      zIndex: 360,
      className: "sheds-heat-layer sheds-search-areas-layer"
    });
    if (searchAreasLayer.setSmooth) searchAreasLayer.setSmooth(false);
    searchAreasLayer.setHeatVisible(!!state.searchAreasVisible);
    return searchAreasLayer;
  }

  function setSearchAreasVisible(on) {
    state.searchAreasVisible = !!on;
    if (state.prefs) {
      state.prefs.searchAreasVisible = state.searchAreasVisible;
      if (Store && Store.saveModelPrefs) Store.saveModelPrefs(state.prefs);
    }
    var btn = $("btn-search-areas");
    if (btn) btn.setAttribute("aria-pressed", state.searchAreasVisible ? "true" : "false");
    var chk = $("search-areas-visible");
    if (chk) chk.checked = state.searchAreasVisible;
    var legend = $("search-areas-legend");
    if (legend) legend.setAttribute("data-on", state.searchAreasVisible ? "true" : "false");
    if (!state.searchAreasVisible) {
      if (state.searchAreasAbort) {
        try { state.searchAreasAbort.abort(); } catch (e2) { /* */ }
        state.searchAreasAbort = null;
      }
      state.searchAreasFetchGen += 1;
      if (searchAreasLayer) {
        searchAreasLayer.setHeatVisible(false);
        searchAreasLayer.setGrid({ cells: [], bounds: { west: 0, east: 0, south: 0, north: 0 }, rows: 0, cols: 0 });
      }
      state.searchAreasStatus = "idle";
      syncSearchAreasLegend();
      return;
    }
    ensureSearchAreasLayer();
    scheduleSearchAreas(80);
  }

  function syncSearchAreasLegend() {
    var legend = $("search-areas-legend");
    if (!legend) return;
    legend.hidden = false;
    legend.setAttribute("data-on", state.searchAreasVisible ? "true" : "false");
    var body = $("search-areas-legend-body");
    if (body) body.hidden = !state.searchAreasVisible;
    var status = $("search-areas-legend-status");
    if (!status) return;
    if (!state.searchAreasVisible) {
      status.textContent = "Terrain search priority — off";
      return;
    }
    if (state.searchAreasStatus === "loading") status.textContent = "Reading terrain…";
    else if (state.searchAreasStatus === "insufficient_zoom") status.textContent = "Zoom in to inspect terrain";
    else if (state.searchAreasStatus === "unavailable") status.textContent = "Terrain intelligence unavailable here";
    else if (state.searchAreasStatus === "incomplete") status.textContent = "Not enough terrain data";
    else if (state.searchAreasStatus === "failed") status.textContent = "Terrain intelligence unavailable here";
    else status.textContent = "Higher / Moderate / Lower — not a find chance";
  }

  function applySearchAreasGrid(grid) {
    ensureSearchAreasLayer();
    state.lastSearchAreasGrid = grid;
    if (searchAreasLayer) {
      searchAreasLayer.setGrid(grid || { cells: [], bounds: { west: 0, east: 0, south: 0, north: 0 }, rows: 0, cols: 0 });
      searchAreasLayer.setHeatVisible(!!state.searchAreasVisible);
    }
    syncSearchAreasLegend();
  }

  function recomputeSearchAreas() {
    if (!map || !SearchPriority) return;
    if (!state.searchAreasVisible) {
      applySearchAreasGrid({ cells: [], bounds: { west: 0, east: 0, south: 0, north: 0 }, rows: 0, cols: 0 });
      return;
    }
    var zoom = map.getZoom();
    var mapBounds = map.getBounds();
    var rawBounds = {
      north: mapBounds.getNorth(),
      south: mapBounds.getSouth(),
      west: mapBounds.getWest(),
      east: mapBounds.getEast()
    };
    var searchBounds = SearchPriority.clampSearchBounds
      ? SearchPriority.clampSearchBounds(rawBounds)
      : rawBounds;
    var rows = SearchPriority.GRID_ROWS || 12;
    var cols = SearchPriority.GRID_COLS || 12;
    if (zoom < (SearchPriority.MIN_ZOOM || 12)) {
      state.searchAreasStatus = "insufficient_zoom";
      applySearchAreasGrid(SearchPriority.evaluateGrid({
        zoom: zoom,
        bounds: searchBounds,
        rows: rows,
        cols: cols,
        elevations: []
      }));
      return;
    }
    if (state.offlineForced || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      state.searchAreasStatus = "unavailable";
      applySearchAreasGrid({
        renderMode: "search-priority",
        status: "unavailable",
        rows: 0,
        cols: 0,
        cells: [],
        bounds: searchBounds,
        message: SearchPriority.COPY.UNAVAILABLE
      });
      return;
    }
    state.searchAreasStatus = "loading";
    syncSearchAreasLegend();
    fetchSearchAreaElevations(mapBounds, rows, cols).then(function (elev) {
      if (!state.searchAreasVisible) return;
      if (elev && elev.failed) {
        state.searchAreasStatus = "failed";
        applySearchAreasGrid({
          renderMode: "search-priority",
          status: "failed",
          rows: 0,
          cols: 0,
          cells: [],
          bounds: searchBounds,
          message: SearchPriority.COPY.FAILED
        });
        return;
      }
      if (!elev) return;
      var grid = SearchPriority.evaluateGrid({
        zoom: map.getZoom(),
        bounds: searchBounds,
        rows: rows,
        cols: cols,
        elevations: elev
      });
      state.searchAreasStatus = grid.status || "ready";
      applySearchAreasGrid(grid);
    });
  }

  function formatLocalClock(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    try {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
    }
  }

  function hourFromIso(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.getHours() + d.getMinutes() / 60;
  }

  function weatherAnchorLatLng() {
    if (state.selectedLocation && isFinite(state.selectedLocation.lat) && isFinite(state.selectedLocation.lng)) {
      return {
        lat: state.selectedLocation.lat,
        lng: state.selectedLocation.lng,
        source: state.selectedLocation.source || "selected"
      };
    }
    if (state.userLatLng && isFinite(state.userLatLng.lat) && isFinite(state.userLatLng.lng)) {
      return { lat: state.userLatLng.lat, lng: state.userLatLng.lng, source: "gps" };
    }
    if (map) {
      var c = map.getCenter();
      if (c && isFinite(c.lat) && isFinite(c.lng)) {
        return { lat: c.lat, lng: c.lng, source: "map-center" };
      }
    }
    return null;
  }

  function weatherNeedsRefresh(lat, lng) {
    if (!state.weather || state.weatherStatus !== "ready") return true;
    if (state.offlineForced || (typeof navigator !== "undefined" && navigator.onLine === false)) return false;
    var prevLat = state.weather.fetchLat;
    var prevLng = state.weather.fetchLng;
    if (typeof prevLat !== "number" || typeof prevLng !== "number") return true;
    // ~55 km at mid-latitudes — refetch when the view/anchor moved meaningfully
    return Math.abs(prevLat - lat) > 0.5 || Math.abs(prevLng - lng) > 0.5;
  }

  /**
   * Today's Search must get live weather for the GPS fix OR the map center —
   * including cold-start / GPS-denied / zoomed-out views where heat is skipped.
   */
  function ensureWeatherForView(opts) {
    opts = opts || {};
    if (state.offlineForced || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      state.weatherStatus = state.weather ? state.weatherStatus : "unavailable";
      return Promise.resolve(state.weather || null);
    }
    var anchor = weatherAnchorLatLng();
    if (!anchor) {
      state.weatherStatus = "unavailable";
      return Promise.resolve(null);
    }
    if (!opts.force && !weatherNeedsRefresh(anchor.lat, anchor.lng)) {
      return Promise.resolve(state.weather);
    }
    var gen = ++state.weatherFetchGen;
    return fetchWeatherSoft(anchor.lat, anchor.lng).then(function (w) {
      if (gen !== state.weatherFetchGen) return state.weather;
      if (w) {
        w.fetchLat = anchor.lat;
        w.fetchLng = anchor.lng;
        w.anchorSource = anchor.source;
        state.weather = w;
      }
      if (opts.refreshBriefing !== false) {
        updatePlanner(state.lastGrid || null);
      }
      return w;
    });
  }

  function fetchWeatherSoft(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return Promise.resolve(null);
    state.weatherStatus = "loading";
    if (!Weather || typeof Weather.fetchForecast !== "function") {
      state.weatherStatus = "unavailable";
      return Promise.resolve(null);
    }
    return Weather.fetchForecast(lat, lng).then(function (pkg) {
      if (!pkg || pkg.ready === false) {
        state.weatherStatus = "unavailable";
        return null;
      }
      state.weatherStatus = "ready";
      return pkg;
    }).catch(function () {
      state.weatherStatus = "unavailable";
      return null;
    });
  }

  function modelStamp() {
    var center = map ? map.getCenter() : null;
    var lat = state.userLatLng ? state.userLatLng.lat : (center && center.lat);
    var region = Bio && Bio.regionalContext
      ? Bio.regionalContext(lat, center && center.lng, new Date())
      : null;
    return {
      modelVersion: Bio ? Bio.MODEL_VERSION : null,
      factorConfigVersion: Bio ? Bio.FACTOR_CONFIG_VERSION : null,
      activePreset: state.prefs && state.prefs.activePreset,
      regionalContext: region,
      dataCoverageSummary: state.lastGrid && state.lastGrid.coverage
        ? state.lastGrid.coverage.label
        : null,
      inputDataTimestamp: new Date().toISOString()
    };
  }

  function updateSeasonPill() {
    if (!els.seasonPill) return;
    var sel = selectedLatLng();
    var lat = sel ? sel.lat : 44;
    var timing = Timing
      ? Timing.evaluate({ date: new Date(), lat: lat, prefs: state.prefs || {} })
      : null;
    if (timing) {
      els.seasonPill.textContent = "Timing · " + timing.label +
        (timing.season && timing.season.overridden ? " (adjusted)" : "");
      els.seasonPill.title = timing.supportLine + " — " + (timing.limitations || []).join(" ");
      els.seasonPill.dataset.phase = timing.category || "unknown";
      return;
    }
    if (!Bio) return;
    var season = Bio.seasonProfile(new Date(), lat, state.prefs || {});
    els.seasonPill.textContent = "Timing · " + season.phase + (season.overridden ? " (adjusted)" : "");
    els.seasonPill.title = season.supportLine + " " + season.note;
    els.seasonPill.dataset.phase = season.phaseId;
  }

  function evaluateChannels(plan) {
    var sel = selectedLatLng();
    var lat = sel ? sel.lat : (map ? map.getCenter().lat : 44);
    var lng = sel ? sel.lng : (map ? map.getCenter().lng : -92.5);
    var timing = Timing
      ? Timing.evaluate({ date: new Date(), lat: lat, prefs: state.prefs || {} })
      : null;
    var habitat;
    if (state.searchLocation && HabitatGis && state.lastGrid && state.lastGrid.renderMode === "gis-bands") {
      if (state.lastGrid.unavailable || state.lastGrid.habitatEmpty) {
        habitat = {
          channel: "habitat",
          empty: true,
          label: "Habitat data unavailable for this area",
          detail: "No GIS pack covers this SEARCH LOCATION — no decorative fallback.",
          interest: null,
          band: "neutral",
          why: ["Tap a SEARCH LOCATION inside a packed PA region (e.g. Pike/Milford)."],
          limitations: ["Landscape structure does not mean an antler is present."],
          provenance: [{ factor: "gis-pack", class: "SOURCE_FACT", missing: true }]
        };
      } else {
        var mid = heatLayer && heatLayer.nearestCell
          ? heatLayer.nearestCell({ lat: state.searchLocation.lat, lng: state.searchLocation.lng })
          : null;
        var scored = mid && mid.result ? mid.result : null;
        habitat = {
          channel: "habitat",
          empty: false,
          label: scored && scored.label ? scored.label : "Habitat structure in SEARCH AREA",
          band: scored && scored.band ? scored.band.id : "some",
          interest: scored ? scored.score : null,
          why: scored && scored.why ? scored.why.slice(0, 3) : ["NLCD structure + edge + slope inside SEARCH AREA."],
          limitations: (scored && scored.limitations) || [
            "Landscape structure does not mean an antler is present.",
            "~30 m land-cover resolution — not meter-precise."
          ],
          provenance: [
            { factor: "nlcd", class: "SOURCE_FACT" },
            { factor: "edge", class: "WAYPOINT_HEURISTIC" },
            { factor: "slope", class: "SOURCE_FACT" }
          ],
          gis: true
        };
      }
    } else if (!state.searchLocation) {
      habitat = {
        channel: "habitat",
        empty: true,
        label: "Tap the area you want to analyze",
        detail: "Fine habitat GIS uses SEARCH LOCATION — not coarse YOU.",
        interest: null,
        band: "neutral",
        why: ["Set a SEARCH LOCATION to analyze landscape structure."],
        limitations: ["Coarse YOU (±km) must not drive fine GIS."],
        provenance: []
      };
    } else {
      habitat = Habitat
        ? Habitat.scoreCell({
            lat: lat,
            lng: lng,
            date: new Date(),
            prefs: state.prefs || {},
            observations: Store.list(),
            terrain: state.elevCache
              ? { source: "map-derived", slope: 10, morphology: { source: "map-derived" } }
              : { source: "unavailable" },
            weather: null
          })
        : { empty: true, label: "No habitat-specific guidance yet", channel: "habitat" };
    }
    if (state.lastGrid && state.lastGrid.habitatEmpty && !(state.lastGrid.renderMode === "gis-bands")) {
      habitat = Object.assign({}, habitat, {
        empty: true,
        label: (Habitat && Habitat.EMPTY_MESSAGE) || "No habitat-specific guidance yet",
        interest: null,
        band: "neutral"
      });
    } else if (state.heatMode === "observed") {
      var obsCount = Store.list().length;
      habitat = {
        channel: "habitat",
        empty: obsCount === 0,
        label: obsCount ? "Your observations" : ((Habitat && Habitat.EMPTY_MESSAGE) || "No habitat-specific guidance yet"),
        detail: obsCount
          ? "Observed-only heat from private notes — not where sheds are."
          : ((Habitat && Habitat.EMPTY_DETAIL) || ""),
        interest: null,
        band: obsCount ? "moderate" : "neutral",
        why: [obsCount ? "Your observations only." : "No matching private observations."],
        provenance: obsCount ? [{ factor: "observations", class: "SOURCE_FACT" }] : []
      };
    }
    var searchability = Searchability
      ? Searchability.evaluate({
          weather: state.weather,
          season: timing && timing.season,
          locationStatus: state.locationStatus === "available" ? "ready"
            : state.locationStatus === "denied" ? "denied"
              : state.locationStatus === "finding" ? "loading"
                : "unavailable",
          weatherStatus: state.weatherStatus === "ready" ? "ready"
            : state.weatherStatus === "loading" ? "loading"
              : "unavailable",
          patterns: Patterns ? Patterns.aggregatePatterns(Store.list()) : null,
          plan: plan || state.lastPlan
        })
      : null;
    var confidence = Confidence
      ? Confidence.evaluate({
          timing: timing,
          habitat: habitat,
          searchability: searchability,
          weatherStatus: state.weatherStatus,
          envFailed: state.weatherStatus === "unavailable",
          elevFailed: !state.elevCache && !(state.lastGrid && state.lastGrid.renderMode === "gis-bands" && !state.lastGrid.unavailable)
        })
      : { level: "Low", label: "Low", why: ["Confidence module unavailable."] };
    if (HabitatGis && state.lastGrid && state.lastGrid.renderMode === "gis-bands") {
      var gisSupport = state.lastGrid.evidenceSupport || HabitatGis.evidenceSupport({
        unavailable: !!state.lastGrid.unavailable,
        hasStructure: !state.lastGrid.unavailable,
        hasTerrain: !state.lastGrid.unavailable,
        hasObservations: Store.list().length > 0
      });
      confidence = Object.assign({}, confidence, {
        level: gisSupport.level,
        label: gisSupport.level,
        why: [gisSupport.detail].concat(confidence.why || []).slice(0, 4),
        meaning: "evidence_support"
      });
    }
    state.lastChannels = {
      timing: timing,
      habitat: habitat,
      searchability: searchability,
      confidence: confidence
    };
    renderChannelPanel(state.lastChannels);
    publishLocationDebug();
    return state.lastChannels;
  }

  function renderChannelPanel(ch) {
    if (!ch) return;
    var timingEl = $("channel-timing");
    var habitatEl = $("channel-habitat");
    var searchEl = $("channel-searchability");
    var confEl = $("channel-confidence");
    var whereEl = $("channel-where");
    var obsEl = $("channel-observed");
    var nextEl = $("channel-next");
    var whyTiming = $("why-timing");
    var whySearch = $("why-searchability");
    var whyHabitat = $("why-habitat");
    var limitsEl = $("channel-limitations");
    var area = activeAreaRecord();
    var hasSearch = !!state.searchLocation;
    var offline = !!(state.offlineForced || (typeof navigator !== "undefined" && navigator.onLine === false));

    if (timingEl && ch.timing) {
      var plain = (Ux && Ux.timingPlain) ? Ux.timingPlain(ch.timing) : (ch.timing.plainLabel || ch.timing.label);
      timingEl.textContent = plain + (ch.timing.supportLine ? " — " + ch.timing.supportLine : "");
    }
    if (whereEl) {
      whereEl.textContent = (Ux && Ux.whereLine)
        ? Ux.whereLine(
          state.searchLocation,
          area && area.name,
          area ? area.radiusM : searchRadiusM()
        )
        : (hasSearch ? "Search Area set" : "Tap the map to choose an area to inspect.");
    }
    if (habitatEl && ch.habitat) {
      habitatEl.textContent = (Ux && Ux.landscapeLine)
        ? Ux.landscapeLine(ch.habitat)
        : (ch.habitat.empty
          ? (ch.habitat.label || "Landscape guidance isn’t available for this area yet.")
          : (ch.habitat.label + (ch.habitat.band ? " · " + ch.habitat.band : "")));
    }
    if (searchEl && ch.searchability) {
      var wxLine = Ux && Ux.weatherStatusLine
        ? Ux.weatherStatusLine(state.weatherStatus === "ready" ? "ready" : (offline || !state.weather ? "weather_unavailable" : state.weatherStatus), offline)
        : null;
      searchEl.textContent = wxLine || ch.searchability.headline || "Field conditions";
    }
    if (obsEl) {
      var obsSum = Ux && Ux.summarizeObservationsForArea
        ? Ux.summarizeObservationsForArea(
          Store.list(),
          state.searchLocation,
          hasSearch ? searchRadiusM() : null
        )
        : { summary: "No field observations recorded here yet." };
      obsEl.textContent = obsSum.summary;
    }
    if (nextEl) {
      nextEl.textContent = (Ux && Ux.nextLine)
        ? Ux.nextLine({
          tracking: !!state.tracking,
          hasSearch: hasSearch,
          gisUnavailable: !!(ch.habitat && (ch.habitat.unavailable || ch.habitat.empty)),
          weatherUnavailable: offline || !state.weather
        })
        : "Open Field Plan or Start Search when ready.";
    }
    if (confEl && ch.confidence) {
      confEl.textContent = "Evidence support: " + ch.confidence.level + " — not find probability";
    }
    if (whyTiming && ch.timing) {
      whyTiming.textContent = (ch.timing.why || []).slice(0, 2).join(" ");
    }
    if (whySearch && ch.searchability) {
      whySearch.textContent = (ch.searchability.why || []).slice(0, 2).join(" ");
    }
    if (whyHabitat && ch.habitat) {
      whyHabitat.textContent = ch.habitat.empty
        ? (ch.habitat.detail || ch.habitat.label || "")
        : (ch.habitat.why || []).slice(0, 2).join(" ");
    }
    if (limitsEl) {
      limitsEl.textContent =
        "Guidance only — not exact cast dates, density, or find probability.";
    }
  }

  function applyGridToUi(grid, meta) {
    meta = meta || {};
    state.lastGrid = grid;
    ensureHeatLayer();
    if (heatLayer) {
      heatLayer.setGrid(grid);
      if (heatLayer.setShowConfidence) heatLayer.setShowConfidence(!!state.prefs.showConfidence);
    }
    updateCoverageUi(grid.coverage);
    var mode = grid.cells[0] && grid.cells[0].result && grid.cells[0].result.inputMode;
    setModelCoverageNote(
      (meta.label || "Biological model v" + (Bio && Bio.MODEL_VERSION)) +
      " — " + grid.disclaimer +
      " Cells ~" + grid.cellMetersApprox + " m." +
      (mode ? " Input mode: " + mode + "." : "") +
      (meta.elevNote ? " " + meta.elevNote : "")
    );
    updateActiveInputsSummary(grid);
    refreshCoverageMarks();
    updatePlanner(grid);
    updateSeasonPill();
    syncHeatLegend();
  }

  function buildContext(elev, rows, cols, cacheState) {
    return {
      date: new Date(),
      prefs: state.prefs,
      observations: Store.list(),
      elevations: elev,
      weather: state.offlineForced ? null : state.weather,
      sessions: Sessions,
      offlineForced: !!state.offlineForced,
      terrainCacheState: cacheState || (elev ? "cached-or-live" : "unavailable"),
      cellMetersApprox: null
    };
  }

  function recomputeObservedHeat(bounds, gen) {
    if (!Patterns) return;
    var filters = currentHeatFilters();
    var grid = Patterns.buildObservationHeatGrid(
      bounds, GRID_ROWS, GRID_COLS, Store.list(), filters, { nowMs: Date.now() }
    );
    if (gen !== state.recomputeGen) return;
    state.heatPhase = "refine";
    applyGridToUi(grid, {
      label: "Observed activity (private notes only)",
      elevNote: grid.observationCount
        ? ("Filter: " + (grid.filterSummary || "all") + ".")
        : "No matching private observations — heat intentionally empty (no demo data)."
    });
  }

  function recomputeHeat() {
    if (!map || !Model) return;
    var gen = ++state.recomputeGen;
    if (state.elevAbort) {
      try { state.elevAbort.abort(); } catch (e) { /* */ }
      state.elevAbort = null;
    }
    var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if (heatLayer) {
      heatLayer.setHeatVisible(!!state.prefs.heatVisible);
      heatLayer.setHeatOpacity(state.prefs.opacity);
    }
    var bounds = map.getBounds();
    if (map.getZoom() < 9) {
      state.heatPhase = "zoom";
      setModelCoverageNote("Zoom in for habitat walk-interest (notes / weak terrain). Season alone does not paint heat.");
      if (heatLayer) {
        heatLayer.setGrid({ cells: [], bounds: { west: 0, east: 0, south: 0, north: 0 }, rows: 0, cols: 0 });
      }
      updateCoverageUi({ level: "limited", label: "Limited input coverage — zoom for local analysis" });
      // Heat waits for zoom, but Today's Search still needs map-center weather/daylight.
      ensureWeatherForView({ refreshBriefing: true });
      updatePlanner(null);
      syncHeatLegend();
      return;
    }

    // Keep weather fresh for Today's Search even in observed-heat mode
    var center = map.getCenter();
    var wxPromise = state.offlineForced ? Promise.resolve(null)
      : ensureWeatherForView({ refreshBriefing: false });

    if (state.heatMode === "observed") {
      try {
        recomputeObservedHeat(bounds, gen);
      } catch (e) {
        console.error("sheds observed heat", e);
      }
      wxPromise.then(function (w) {
        if (gen !== state.recomputeGen) return;
        if (w) state.weather = w;
        updatePlanner(state.lastGrid);
      });
      return;
    }

    // Phase 2: Habitat GIS only when SEARCH LOCATION is set — never from coarse YOU alone.
    if (HabitatGis && GisPack) {
      preserveSearchAcrossSideEffects();
      if (!state.searchLocation) {
        state.heatPhase = "idle";
        if (heatLayer) {
          heatLayer.setGrid({
            cells: [],
            bounds: { west: 0, east: 0, south: 0, north: 0 },
            rows: 0,
            cols: 0,
            habitatEmpty: true,
            unavailable: true,
            renderMode: "gis-bands",
            modelVersion: "habitat-gis-2.0",
            coverage: { level: "limited", label: "Tap a SEARCH LOCATION to analyze habitat" }
          });
        }
        setModelCoverageNote("Tap the area you want to analyze — coarse YOU does not drive fine habitat GIS.");
        updateCoverageUi({ level: "limited", label: "No SEARCH LOCATION yet" });
        state.lastGrid = {
          cells: [],
          habitatEmpty: true,
          unavailable: true,
          modelVersion: "habitat-gis-2.0",
          coverage: { level: "limited", label: "No SEARCH LOCATION yet" }
        };
        syncHeatLegend();
        syncSearchPrompt();
        wxPromise.then(function (w) {
          if (gen !== state.recomputeGen) return;
          if (w) state.weather = w;
          updatePlanner(null);
          evaluateChannels(null);
        });
        return;
      }

      ensureGisPacks().then(function () {
        if (gen !== state.recomputeGen) return;
        var pack = packForSearch();
        var tGis = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        var grid = HabitatGis.buildSearchGrid({
          center: { lat: state.searchLocation.lat, lng: state.searchLocation.lng },
          radiusM: searchRadiusM(),
          pack: pack,
          observations: Store.list(),
          Bio: Bio,
          includeObservations: !!(state.prefs && state.prefs.includeObservationsInHabitat),
          rows: 22,
          cols: 22
        });
        // Never pass weather/season into GIS grid (already omitted in HabitatGis).
        if (gen !== state.recomputeGen) return;
        state.heatPhase = "refine";
        state.lastPerf.gisMs = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - tGis;
        state.lastPerf.refineMs = state.lastPerf.gisMs;
        applyGridToUi(grid, {
          label: grid.unavailable
            ? "Habitat data unavailable for this area"
            : "Habitat structure (SEARCH AREA · ~30 m)",
          elevNote: grid.unavailable
            ? "No GIS pack covers this SEARCH LOCATION — no decorative fallback."
            : ("Pack " + (grid.packId || "?") + " · radius ~" + grid.radiusM + " m · " +
              (grid.guidanceMode === "combined" ? "COMBINED guidance" : "MODEL only") + " · not find %")
        });
        wxPromise.then(function (w) {
          if (gen !== state.recomputeGen) return;
          if (w) state.weather = w;
          preserveSearchAcrossSideEffects();
          updatePlanner(state.lastGrid);
        });
      });
      return;
    }

    // Legacy Phase 1 fallback if GIS modules missing — Coarse first pass
    try {
      var coarse = Model.buildGrid(bounds, COARSE_ROWS, COARSE_COLS, buildContext(null, COARSE_ROWS, COARSE_COLS, "unavailable"));
      if (gen !== state.recomputeGen) return;
      state.heatPhase = "coarse";
      applyGridToUi(coarse, {
        label: "Coarse habitat interest (limited terrain)",
        elevNote: "Refining with elevation when available… Season/weather excluded from habitat heat."
      });
      state.lastPerf.coarseMs = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0;
    } catch (e) {
      console.error("sheds coarse heat", e);
    }

    Promise.all([
      state.offlineForced ? Promise.resolve(null) : fetchElevations(bounds),
      wxPromise
    ]).then(function (pair) {
      if (gen !== state.recomputeGen) return;
      var elev = pair[0];
      if (pair[1]) state.weather = pair[1];
      var t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      var grid = Model.buildGrid(bounds, GRID_ROWS, GRID_COLS, buildContext(elev, GRID_ROWS, GRID_COLS, elev ? "live-or-cached" : "unavailable"));
      if (gen !== state.recomputeGen) return;
      state.heatPhase = "refine";
      applyGridToUi(grid, {
        label: grid.habitatEmpty
          ? "No habitat-specific guidance yet"
          : "Habitat walk-interest (notes + weak elev)",
        elevNote: elev
          ? "Elevation sampled for weak terrain cues (labeled weak)."
          : (state.offlineForced || navigator.onLine === false
            ? "Elevation skipped (offline / limited-data)."
            : "Elevation unavailable — habitat heat needs notes or terrain.")
      });
      state.lastPerf.refineMs = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t1;
      state.lastPerf.totalMs = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0;
    }).catch(function (err) {
      console.error("sheds refine heat", err);
    });
  }

  function refreshCoverageMarks() {
    if (!coverageLayer || !Sessions) return;
    coverageLayer.clearLayers();
    if (state.prefs && state.prefs.coverageVisible === false) return;
    Sessions.listCoverage().forEach(function (c) {
      var color = c.level === "thorough" ? "#888888"
        : c.level === "revisit" ? "#c8f055" : "#9b8fd9";
      var circle = L.circleMarker([c.lat, c.lng], {
        radius: c.level === "thorough" ? 7 : 5,
        color: "#0a1220",
        weight: 1,
        fillColor: color,
        fillOpacity: 0.55
      });
      circle.bindTooltip("Search mark: " + c.level, { direction: "top" });
      coverageLayer.addLayer(circle);
    });
  }

  function updatePlanner(grid) {
    if (!Planner || !els.planCard) return;
    var plan = Planner.plan({
      grid: grid,
      userLatLng: state.userLatLng ? { lat: state.userLatLng.lat, lng: state.userLatLng.lng } : {
        lat: map.getCenter().lat,
        lng: map.getCenter().lng
      },
      sessions: Sessions,
      observations: Store.list(),
      model: Model
    });
    state.lastPlan = plan;
    renderPlanCard(plan);
    drawPlanOnMap(plan);
  }

  function setPlanExpanded(open) {
    state.planExpanded = !!open;
    if (!els.planCard) return;
    els.planCard.dataset.expanded = state.planExpanded ? "true" : "false";
    if (els.planDetails) els.planDetails.hidden = !state.planExpanded;
    if (els.btnTogglePlan) {
      els.btnTogglePlan.setAttribute("aria-expanded", state.planExpanded ? "true" : "false");
    }
    document.documentElement.classList.toggle("sheds-sheet-open", state.planExpanded);
    invalidateMapSize();
  }

  function renderPlanCard(plan) {
    if (!els.planCard) return;
    var glance = els.planGlance || els.planBody;
    var conf = $("plan-stars");
    var stats = $("plan-stats");
    var channels = evaluateChannels(plan);
    var brief = refreshTodaysSearch(plan);
    var hunt = refreshTodayHunt(plan);
    renderTodayHunt(hunt);
    var statusEl = $("today-status");
    var uncertainEl = $("today-uncertain");
    var whyWrap = document.querySelector(".sheds-plan__why-wrap");
    if (whyWrap) whyWrap.hidden = false;
    var hasSearch = !!state.searchLocation;
    var offline = !!(state.offlineForced || (typeof navigator !== "undefined" && navigator.onLine === false));
    var timingPlain = channels && channels.timing
      ? ((Ux && Ux.timingPlain) ? Ux.timingPlain(channels.timing) : channels.timing.plainLabel || channels.timing.label)
      : "Season";
    var landscapeShort = "Landscape";
    if (channels && channels.habitat) {
      if (channels.habitat.unavailable || channels.habitat.empty) landscapeShort = "No landscape yet";
      else if (channels.habitat.band) landscapeShort = "Landscape · " + channels.habitat.band;
      else landscapeShort = channels.habitat.label || "Landscape · MODEL";
    }

    if (brief) {
      renderTodayWindows(brief);
      renderTodayAreas(brief);
      renderTodaySignals(brief);
      if (statusEl) {
        var st = brief.status;
        if (st === "loading") statusEl.textContent = "Reading today’s field conditions…";
        else if (st === "location_denied") {
          statusEl.textContent = state.weather
            ? "Location denied — weather and daylight use the map center until you locate."
            : "Location denied — map stays usable; live conditions for the map center may be unavailable.";
        }
        else if (st === "weather_unavailable") {
          statusEl.textContent = (Ux && Ux.EMPTY.NO_WEATHER) ||
            "Live conditions unavailable. Your saved area and field records still work.";
        }
        else if (st === "partial") statusEl.textContent = "Partial inputs — some signals missing.";
        else statusEl.textContent = brief.summaryLine || brief.headline;
      }
      if (uncertainEl) {
        uncertainEl.textContent = (brief.uncertainties || []).join(" ");
      }
    }

    if (els.planTitle) {
      if (hunt && hunt.status === "loading") {
        els.planTitle.textContent = "Reading today…";
      } else if (hunt && hunt.rated) {
        els.planTitle.textContent = hunt.band + " · " + (hunt.season && hunt.season.label ? hunt.season.label : "Season");
      } else if (hunt && hunt.band) {
        els.planTitle.textContent = hunt.band;
      } else if (hasSearch) {
        els.planTitle.textContent = timingPlain + " · " + landscapeShort;
      } else {
        els.planTitle.textContent = "Choose a Search Area";
      }
    }
    if (glance) {
      if (hunt && hunt.today) {
        glance.textContent = hunt.today;
      } else if (!hasSearch) {
        glance.textContent = (Ux && Ux.EMPTY.NO_SEARCH) || "Tap the map to choose an area to inspect.";
      } else if (brief && (brief.status === "weather_unavailable" || offline)) {
        glance.textContent = (Ux && Ux.EMPTY.NO_WEATHER) ||
          "Live conditions unavailable. Your saved area and field records still work.";
      } else if (brief && brief.headline) {
        glance.textContent = brief.headline;
      } else {
        glance.textContent = "Review Field Plan, then Start Search when ready.";
      }
    }
    if (conf) {
      if (state.tracking) {
        conf.textContent = "Search active — End Search when done";
      } else if (hunt && hunt.status === "need_location") {
        conf.textContent = "Next: share a location";
      } else if (hunt && hunt.status === "not_rated") {
        conf.textContent = "Live conditions unavailable";
      } else if (!hasSearch) {
        conf.textContent = "Next: set Search Area for where to look";
      } else {
        conf.textContent = "Next: Field Plan or Start Search";
      }
      conf.setAttribute("aria-label", conf.textContent);
    }

    var actions = $("plan-actions") || document.querySelector(".sheds-plan__actions");
    if (actions) actions.hidden = false;
    var gotoBtn = $("btn-goto-plan");
    var markPartial = $("btn-mark-partial");
    var markThorough = $("btn-mark-thorough");
    var markRevisit = $("btn-mark-revisit");

    if (!plan || !plan.ok || !plan.recommendation) {
      els.planCard.dataset.hasPlan = "false";
      if (gotoBtn) gotoBtn.hidden = true;
      if (markPartial) markPartial.hidden = true;
      if (markThorough) markThorough.hidden = true;
      if (markRevisit) markRevisit.hidden = true;
      if (els.planBody) {
        els.planBody.textContent = hasSearch
          ? "Search Area set. Open Field Plan for the full checklist, or Start Search to record a session."
          : ((Ux && Ux.EMPTY.NO_SEARCH) || "Tap the map to choose an area to inspect.");
      }
      if (els.planWhy) {
        els.planWhy.textContent = brief && brief.disclaimer
          ? brief.disclaimer
          : "Relative guidance only.";
      }
      if (els.planMeta) {
        els.planMeta.textContent = brief && brief.epistemicNote
          ? brief.epistemicNote
          : "Facts vs analysis vs uncertainty are labeled in signals.";
      }
      if (stats) stats.hidden = true;
      els.planCard.setAttribute(
        "aria-label",
        "Field briefing. " + (els.planTitle ? els.planTitle.textContent + ". " : "") +
          (glance ? glance.textContent : "")
      );
      updateNavMeta();
      syncHeatLegend();
      return;
    }

    els.planCard.dataset.hasPlan = "true";
    if (gotoBtn) gotoBtn.hidden = false;
    if (markPartial) markPartial.hidden = false;
    if (markThorough) markThorough.hidden = false;
    if (markRevisit) markRevisit.hidden = false;
    var r = plan.recommendation;
    var dist = r.distanceM != null && Planner ? Planner.formatDistance(r.distanceM) : "";
    var dir = r.bearingLabel || "";
    var glanceText = [dir, dist].filter(Boolean).join(" · ");
    if (!glanceText) glanceText = r.walkingHint || "Nearby pocket";
    if (glance && !hunt) {
      var win = brief && brief.timeWindows && brief.timeWindows[0]
        ? brief.timeWindows[0].label + " · "
        : "";
      glance.textContent = win + glanceText;
    }
    if (stats) {
      stats.hidden = false;
      if ($("plan-stat-dir")) $("plan-stat-dir").textContent = dir || "—";
      if ($("plan-stat-dist")) $("plan-stat-dist").textContent = dist || "—";
      if ($("plan-stat-area")) $("plan-stat-area").textContent = "~" + r.suggestedRadiusM + " m";
      if ($("plan-stat-band")) {
        var bandLabel = r.band === "higher" ? "Higher interest"
          : r.band === "moderate" ? "Moderate"
          : r.band === "lower" ? "Lower"
          : r.band === "neutral" ? "Neutral"
          : (r.band || "—");
        $("plan-stat-band").textContent = bandLabel;
      }
    }
    if (els.planBody) {
      var walk = r.walkingHint || glanceText;
      els.planBody.textContent =
        (brief && brief.summaryLine ? brief.summaryLine + " " : "") +
        walk +
        " Suggested walk guidance only — not a biological hotspot claim or find probability.";
    }
    var whyParts = [];
    if (r.why && r.why.length) whyParts = whyParts.concat(r.why.slice(0, 3));
    else if (r.explanation) whyParts.push(r.explanation);
    if (brief && brief.observationInsight) {
      if (brief.observationInsight.sufficient && brief.observationInsight.summary) {
        whyParts.push(brief.observationInsight.summary);
      } else if (brief.observationInsight.insufficiencyReason) {
        whyParts.push(brief.observationInsight.insufficiencyReason);
      }
    }
    if (els.planWhy) els.planWhy.textContent = whyParts.join(" ");
    var meta = [];
    if (brief) meta.push("Confidence: " + brief.confidence + " — " + (brief.confidenceWhy || ""));
    if (plan.remainingHighCount != null && plan.remainingHighCount > 0) {
      meta.push(plan.remainingHighCount + " higher pockets still unmarked thorough");
    }
    meta.push("Layer: " + (state.heatMode === "observed" ? "Your observations" : "Habitat walk-interest"));
    if (els.planMeta) els.planMeta.textContent = meta.join(" · ");
    els.planCard.setAttribute(
      "aria-label",
      "Today’s Hunt: " + (hunt && hunt.today ? hunt.today + ". " : "") +
        (brief && brief.headline ? brief.headline + ". " : "") + glanceText
    );
    updateNavMeta();
    syncHeatLegend();
  }

  function drawPlanOnMap(plan) {
    if (!planLayer) return;
    planLayer.clearLayers();
    recMarker = null;
    if (!plan || !plan.recommendation) return;
    var r = plan.recommendation;
    // SEARCH area ring — soft amber, not a second “you” pin
    recMarker = L.circle([r.lat, r.lng], {
      radius: r.suggestedRadiusM,
      color: "#e0a046",
      weight: 1.5,
      dashArray: "6 8",
      fillColor: "#e0a046",
      fillOpacity: 0.06,
      className: "sheds-target-ring",
      interactive: false
    }).addTo(planLayer);
    // SEARCH TARGET — amber mark + label — never the same “you” lime dot.
    var marker = L.marker([r.lat, r.lng], {
      icon: L.divIcon({
        className: "sheds-search-target",
        html: "<span class=\"sheds-search-target__mark\" title=\"Area to inspect\"></span><span class=\"sheds-search-target__label\">INSPECT</span>",
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      }),
      keyboard: false,
      riseOnHover: true,
      zIndexOffset: 200
    }).bindTooltip("AREA TO INSPECT — model suggestion (not an antler pin, not YOU)", {
      permanent: true,
      direction: "left",
      offset: [-12, 0],
      className: "sheds-map-tip sheds-map-tip--target"
    });
    marker.addTo(planLayer);
    if (state.userLatLng) {
      L.polyline([
        [state.userLatLng.lat, state.userLatLng.lng],
        [r.lat, r.lng]
      ], { color: "#d4e85a", weight: 2, dashArray: "5 10", opacity: 0.75 }).addTo(planLayer);
    }
  }

  function redrawTrack(session) {
    if (!trackLayer) return;
    trackLayer.clearLayers();
    trackLine = null;
    if (!session || !session.path || session.path.length < 2) return;
    var latlngs = session.path.map(function (p) { return [p.lat, p.lng]; });
    trackLine = L.polyline(latlngs, { color: "#7eb6ff", weight: 4, opacity: 0.85 }).addTo(trackLayer);
  }

  function activeAreaRecord() {
    if (state.activeSearchAreaId && AreaStore) {
      var a = AreaStore.getById(state.activeSearchAreaId);
      if (a) return a;
    }
    if (!state.searchLocation) return null;
    var pack = packForSearch && packForSearch();
    return {
      id: state.activeSearchAreaId || null,
      name: state.activeSearchAreaName || "Current SEARCH",
      center: { lat: state.searchLocation.lat, lng: state.searchLocation.lng },
      radiusM: searchRadiusM(),
      radiusKey: state.searchRadiusKey,
      notes: "",
      gisPackId: pack ? pack.packId : null,
      gisStatus: pack ? "available" : (state.gisPacks && state.gisPacks.length ? "unavailable" : "unknown")
    };
  }

  function syncGuidanceModeLabel() {
    var el = $("guidance-mode-label");
    if (!el) return;
    if (state.heatMode === "observed") {
      el.textContent = "OBSERVED — your private notes (not Habitat MODEL)";
      return;
    }
    if (state.prefs && state.prefs.includeObservationsInHabitat) {
      el.textContent = "COMBINED — GIS MODEL + capped observations";
    } else {
      el.textContent = "MODEL — GIS Habitat (observations excluded)";
    }
  }

  function startTracking() {
    if (!Sessions) {
      setLocStatus("unavailable", "sessions unavailable");
      return;
    }
    var stamp = modelStamp();
    var area = activeAreaRecord();
    var session = Sessions.startSession({
      speciesId: Store.SPECIES_WHITETAIL,
      searchAreaId: area && area.id ? area.id : null,
      searchAreaName: area ? area.name : null,
      weatherSummary: state.weather ? { snowMm: state.weather.snowMm, source: state.weather.source } : null,
      modelVersion: stamp.modelVersion,
      factorConfigVersion: stamp.factorConfigVersion,
      activePreset: stamp.activePreset,
      regionalContext: stamp.regionalContext,
      dataCoverageSummary: stamp.dataCoverageSummary,
      inputDataTimestamp: stamp.inputDataTimestamp
    });
    state.activeSessionId = session.id;
    state.tracking = true;
    redrawTrack(session);
    if (els.btnTrack) {
      setFabLabel(els.btnTrack, "End Search");
      els.btnTrack.setAttribute("aria-pressed", "true");
    }
    syncSessionPill("Searching · " + Math.round(session.distanceM || 0) + " m", true);
    syncSessionStrip();
    if (els.sessionPill) els.sessionPill.dataset.state = "available";
    var navDot = $("nav-dot");
    if (navDot) navDot.dataset.state = "tracking";
    if (!navigator.geolocation) {
      syncSessionPill("Searching · distance unavailable", true);
      return;
    }
    if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = navigator.geolocation.watchPosition(function (pos) {
      var lat = pos.coords.latitude;
      var lng = pos.coords.longitude;
      var ll = L.latLng(lat, lng);
      var moved = applyUserPosition(
        ll,
        pos.coords.accuracy,
        pos.coords.heading != null && !isNaN(pos.coords.heading) ? pos.coords.heading : null,
        { force: false }
      );
      setLocStatus(
        "available",
        state.locationKind === LOCATION_KIND.USER_APPROXIMATE ? "searching · approximate" : "searching"
      );
      preserveSearchAcrossSideEffects();
      var updated = Sessions.appendTrackPoint(state.activeSessionId, lat, lng, Date.now());
      redrawTrack(updated);
      if (updated) {
        syncSessionPill("Searching · " + Math.round(updated.distanceM || 0) + " m", true);
        syncSessionStrip();
      }
      if (moved) scheduleRecompute(1200);
    }, function (err) {
      if (err && err.code === 1) setLocStatus("denied", "GPS denied — session continues without distance");
      else setLocStatus("unavailable", "GPS error — session continues without distance");
      syncSessionPill("Searching · distance unavailable", true);
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
  }

  function stopTracking() {
    if (state.watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    state.tracking = false;
    var summary = null;
    if (state.activeSessionId && Sessions) {
      var noteEl = $("session-note");
      var ended = Sessions.endSession(state.activeSessionId, {
        notes: noteEl ? String(noteEl.value || "").trim() : "",
        weatherSummary: state.weather ? { snowMm: state.weather.snowMm, source: state.weather.source } : null
      });
      if (noteEl) noteEl.value = "";
      if (ended && Sessions.summarizeSession) {
        summary = Sessions.summarizeSession(ended, Store.list());
      }
    }
    state.activeSessionId = null;
    if (els.btnTrack) {
      setFabLabel(els.btnTrack, "Start Search");
      els.btnTrack.setAttribute("aria-pressed", "false");
      els.btnTrack.title = "Start Search";
      els.btnTrack.setAttribute("aria-label", "Start Search");
    }
    syncSessionPill("", false);
    syncSessionStrip();
    scheduleRecompute(200);
    if (summary && FieldUi && FieldUi.renderSessionSummary) {
      FieldUi.renderSessionSummary($("session-summary-body"), summary);
      openSheet($("sheet-session-summary"));
    }
  }

  function markCoverageAtUser(level) {
    var ll = state.userLatLng || (map && map.getCenter());
    if (!ll || !Sessions) return;
    var lat = typeof ll.lat === "function" ? ll.lat() : ll.lat;
    var lng = typeof ll.lng === "function" ? ll.lng() : ll.lng;
    Sessions.markCoverage(lat, lng, level, {
      sessionId: state.activeSessionId,
      source: "user"
    });
    refreshCoverageMarks();
    scheduleRecompute(100);
  }

  function ensureHeatLayer() {
    if (heatLayer || !map || !Heat) return heatLayer;
    heatLayer = Heat.createHeatLayer(map, {
      opacity: (state.prefs && state.prefs.opacity != null) ? state.prefs.opacity : DEFAULT_HEAT_OPACITY
    });
    if (state.prefs && heatLayer.setShowConfidence) {
      heatLayer.setShowConfidence(!!state.prefs.showConfidence);
    }
    return heatLayer;
  }

  function updateCoverageUi(coverage) {
    if (!els.coverage) return;
    els.coverage.textContent = coverage.label;
    els.coverage.dataset.level = coverage.level;
  }

  function setModelCoverageNote(text) {
    if (els.modelNote) els.modelNote.textContent = text;
  }

  function updateActiveInputsSummary(grid) {
    if (!els.inputsSummary) return;
    var bits = ["Species: " + SPECIES_LABEL];
    bits.push("Season: rule-based");
    bits.push("Terrain: " + (grid && state.elevCache ? "elevation-derived" : "unavailable"));
    bits.push("Observations: " + Store.list().length + " local");
    bits.push("Weather snow: " + (state.weather ? "provider" : "unavailable"));
    bits.push(
      "Land cover: " +
        (state.lastGrid && state.lastGrid.renderMode === "gis-bands" && !state.lastGrid.unavailable
          ? ("GIS pack " + (state.lastGrid.packId || "yes") + " (~30 m)")
          : (state.searchLocation ? "unavailable for SEARCH" : "needs SEARCH LOCATION"))
    );
    els.inputsSummary.textContent = bits.join(" · ");
  }

  /**
   * Request browser geolocation and apply YOU / selectedLocation.
   * Sticky denial memory is reconciled against live Permissions API so a later
   * grant is not blocked by an old localStorage flag (Phase 1 owner bug).
   */
  function locateUser(opts) {
    opts = opts || {};
    if (!navigator.geolocation) {
      setLocStatus("unsupported", "This browser has no geolocation API — pan the map manually");
      return;
    }
    if (!opts.force && wasGpsDenied()) {
      setLocStatus("finding", "Checking location permission…");
      probeGeolocationPermission().then(function (perm) {
        if (perm === "granted" || perm === "prompt") {
          rememberGpsDenied(false);
          locateUserNow(opts);
          return;
        }
        if (perm === "denied") {
          setLocStatus(
            "denied",
            "Browser blocked location — enable permission for this site, then tap Locate"
          );
          ensureWeatherForView({ refreshBriefing: true });
          return;
        }
        setLocStatus("denied", "Location was blocked earlier — tap Locate to try again");
        ensureWeatherForView({ refreshBriefing: true });
      });
      return;
    }
    locateUserNow(opts);
  }

  function locateUserNow(opts) {
    opts = opts || {};
    if (navigator.onLine === false && !opts.force) {
      setLocStatus("finding", "Offline — still trying device GPS…");
    } else {
      setLocStatus("finding", "Finding you…");
    }
    var locateGen = ++state.locateGen;
    var geoOpts = {
      enableHighAccuracy: true,
      timeout: opts.force ? 15000 : 12000,
      maximumAge: opts.force ? 0 : 30000
    };
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (locateGen !== state.locateGen) return; // stale locate
      rememberGpsDenied(false);
      var ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      if (pos.coords.heading != null && !isNaN(pos.coords.heading)) state.headingDeg = pos.coords.heading;
      applyUserPosition(ll, pos.coords.accuracy, state.headingDeg, { force: true, source: "geolocation" });
      var accDetail = state.accuracyM != null ? ("±" + Math.round(state.accuracyM) + " m") : "";
      if (state.locationKind === LOCATION_KIND.USER_APPROXIMATE) {
        accDetail = (accDetail ? accDetail + " · " : "") + "approximate — not precise";
        setLocStatus("available", accDetail);
      } else {
        setLocStatus("available", accDetail);
      }
      // Initial acquisition + explicit Locate/Here center on YOU.
      // Do not skip initial center merely because a prior session saved a map view —
      // that left owners looking at Midwest while GPS sat off-screen.
      var shouldCenter = opts.center !== false && !state.userPanned;
      if (shouldCenter) {
        recenterToUser({ zoom: Math.max(map.getZoom(), 13) });
      }
      syncObsLocationHint();
      if (typeof opts.onSuccess === "function") {
        try { opts.onSuccess(ll, pos); } catch (e) { /* */ }
      }
      ensureWeatherForView({ force: true, refreshBriefing: true }).then(function () {
        scheduleRecompute(100);
      });
      scheduleRecompute(100);
    }, function (err) {
      if (locateGen !== state.locateGen) return;
      // Honest failure modes — never rewrite into “manual/exploring” success theater.
      if (err && err.code === 1) {
        rememberGpsDenied(true);
        setLocStatus(
          "denied",
          "Permission denied — enable location for this site, then tap Locate"
        );
      } else if (err && err.code === 3) {
        setLocStatus("timeout", "Location timed out — move to clearer sky and tap Locate");
      } else if (err && err.code === 2) {
        setLocStatus("unavailable", "Location unavailable — pan the map or try Locate again");
      } else {
        setLocStatus("unavailable", "Location unavailable — pan the map or try Locate again");
      }
      ensureWeatherForView({ refreshBriefing: true });
    }, geoOpts);
  }

  function syncObsLocationHint() {
    var hint = $("obs-location-hint");
    if (!hint || !clickLatLng) return;
    var acc = "";
    if (state.userLatLng && state.accuracyM != null &&
        Math.abs(state.userLatLng.lat - clickLatLng.lat) < 1e-6 &&
        Math.abs(state.userLatLng.lng - clickLatLng.lng) < 1e-6) {
      acc = state.accuracyM != null ? (" · GPS ±" + Math.round(state.accuracyM) + " m") : " · at you";
    } else {
      acc = " · map pin";
    }
    hint.textContent =
      "Saving at " + clickLatLng.lat.toFixed(5) + ", " + clickLatLng.lng.toFixed(5) + acc;
  }

  /* —— Sheets —— */
  function openSheet(el) {
    if (!el) return;
    state.lastFocusEl = document.activeElement;
    closeAllSheets({ except: el });
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    var focusable = el.querySelector("button, [href], input, select, textarea");
    if (focusable) focusable.focus();
    if (els.btnMore) els.btnMore.setAttribute("aria-expanded", el === els.sheetTools ? "true" : "false");
    invalidateMapSize();
  }

  function closeSheet(el) {
    if (!el) return;
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    if (els.btnMore && el === els.sheetTools) els.btnMore.setAttribute("aria-expanded", "false");
    if (state.lastFocusEl && typeof state.lastFocusEl.focus === "function") {
      try { state.lastFocusEl.focus(); } catch (e) { /* */ }
    }
    invalidateMapSize();
  }

  function closeAllSheets(opts) {
    opts = opts || {};
    [
      els.sheetObs,
      els.sheetControls,
      els.sheetExplain,
      els.sheetEthics,
      els.sheetHistory,
      els.sheetValidate,
      els.sheetTools,
      $("sheet-areas"),
      $("sheet-scout-spots"),
      $("sheet-hunt-plans"),
      $("sheet-hunt-plan-name"),
      $("sheet-choose-hunt-plan"),
      $("sheet-save-area"),
      $("sheet-field-plan"),
      $("sheet-session-summary")
    ].forEach(function (s) {
      if (s && s !== opts.except) closeSheetQuiet(s);
    });
    if (els.btnMore && !opts.except) els.btnMore.setAttribute("aria-expanded", "false");
  }

  function closeSheetQuiet(el) {
    if (!el) return;
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
  }

  function toDatetimeLocalValue(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function fromDatetimeLocalValue(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function openNewObservation(latlng) {
    clickLatLng = latlng;
    els.obsForm.reset();
    els.obsId.value = "";
    els.obsMode.value = "create";
    $("obs-type").value = "deer_sign";
    $("obs-confidence").value = "probable";
    $("sheds-extra").hidden = true;
    if ($("deer-extra")) $("deer-extra").hidden = true;
    if ($("obs-habitat")) $("obs-habitat").value = "";
    if ($("obs-sex")) $("obs-sex").value = "unknown";
    if ($("obs-class")) $("obs-class").value = "unknown";
    if ($("obs-photo-ref")) $("obs-photo-ref").value = "";
    if ($("obs-when")) $("obs-when").value = toDatetimeLocalValue(new Date().toISOString());
    $("obs-form-title").textContent = "Add observation";
    $("obs-delete").hidden = true;
    toggleObsExtras("deer_sign");
    syncObsLocationHint();
    openSheet(els.sheetObs);
    var typeField = $("obs-type");
    if (typeField && typeof typeField.focus === "function") {
      try { typeField.focus(); } catch (e) { /* */ }
    }
  }

  function openViewObservation(id) {
    var obs = Store.getById(id);
    if (!obs) return;
    clickLatLng = L.latLng(obs.location.lat, obs.location.lng);
    els.obsId.value = obs.id;
    els.obsMode.value = "edit";
    $("obs-type").value = obs.type;
    $("obs-note").value = obs.note || "";
    $("obs-confidence").value = obs.confidence || "uncertain";
    $("obs-quantity").value = obs.quantity != null ? obs.quantity : "";
    if ($("obs-habitat")) {
      $("obs-habitat").value = (obs.details && obs.details.habitat) || "";
    }
    if ($("obs-when")) $("obs-when").value = toDatetimeLocalValue(obs.observedAt);
    if ($("obs-sex")) $("obs-sex").value = (obs.details && obs.details.sex) || "unknown";
    if ($("obs-class")) $("obs-class").value = (obs.details && obs.details.class) || "unknown";
    if ($("obs-photo-ref")) $("obs-photo-ref").value = obs.photoRef || "";
    toggleObsExtras(obs.type);
    if (obs.type === "shed_found" && obs.details) {
      $("shed-side").value = obs.details.side || "unknown";
      $("shed-freshness").value = obs.details.freshness || "unknown";
      $("shed-count").value = obs.details.antlerCount != null ? obs.details.antlerCount : 1;
      $("shed-collected").checked = !!obs.details.collected;
    }
    $("obs-form-title").textContent = "Edit observation";
    $("obs-delete").hidden = false;
    syncObsLocationHint();
    openSheet(els.sheetObs);
  }

  function toggleShedExtra(type) {
    $("sheds-extra").hidden = type !== "shed_found";
  }

  function toggleObsExtras(type) {
    var signWrap = $("sign-detail-wrap");
    if (signWrap) signWrap.hidden = type !== "deer_sign";

    toggleShedExtra(type);
    if ($("deer-extra")) {
      $("deer-extra").hidden = !(type === "deer_seen" || type === "deer_sign");
    }
  }

  function weatherSnapshotForSave() {
    if (!state.weather) return null;
    return {
      capturedAt: new Date().toISOString(),
      source: state.weather.source || "open-meteo",
      tempC: state.weather.tempC,
      windSpeedMs: state.weather.windSpeedMs,
      snowMm: state.weather.snowMm,
      precipMm24h: state.weather.precipMm24h,
      pressureHpa: state.weather.pressureHpa
    };
  }

  function saveObservation(ev) {
    ev.preventDefault();
    if (!clickLatLng) {
      var fallback = state.userLatLng || (map && map.getCenter());
      if (!fallback) {
        var hintEl = $("obs-location-hint");
        if (hintEl) {
          hintEl.textContent = "Pick a map point or locate yourself before saving.";
        }
        return;
      }
      clickLatLng = fallback;
      syncObsLocationHint();
    }
    var type = $("obs-type").value;
    var habitat = $("obs-habitat") ? $("obs-habitat").value : "";
    var atMe = !!(state.userLatLng && clickLatLng &&
      Math.abs(state.userLatLng.lat - clickLatLng.lat) < 1e-6 &&
      Math.abs(state.userLatLng.lng - clickLatLng.lng) < 1e-6);
    var whenIso = $("obs-when") ? fromDatetimeLocalValue($("obs-when").value) : null;
    var precision = atMe ? "gps" : "map-tap";
    var accuracyM = atMe && state.accuracyM != null ? state.accuracyM : null;
    if (atMe && Store.canPlaceFromGps && !Store.canPlaceFromGps(accuracyM)) {
      $("obs-error").textContent = "YOU GPS is too approximate (±" +
        (accuracyM != null ? Math.round(accuracyM) + " m" : "?") +
        "). Tap the map to place this observation.";
      $("obs-error").hidden = false;
      return;
    }
    if (atMe && accuracyM != null && accuracyM > (Store.OBS_GPS_ACCURACY_MAX_M || 80)) {
      precision = "approximate";
    }
    var payload = {
      type: type,
      speciesId: Store.SPECIES_WHITETAIL,
      searchAreaId: state.activeSearchAreaId || null,
      location: {
        lat: clickLatLng.lat,
        lng: clickLatLng.lng,
        precision: precision,
        accuracyM: accuracyM
      },
      observedAt: whenIso || new Date().toISOString(),
      note: $("obs-note").value.trim(),
      confidence: $("obs-confidence").value,
      quantity: $("obs-quantity").value,
      photoRef: $("obs-photo-ref") ? $("obs-photo-ref").value.trim() : "",
      weatherSnapshot: weatherSnapshotForSave(),
      details: {}
    };
    if (habitat) payload.details.habitat = habitat;
    if (type === "deer_seen" || type === "deer_sign") {
      payload.details.sex = $("obs-sex") ? $("obs-sex").value : "unknown";
      payload.details.class = $("obs-class") ? $("obs-class").value : "unknown";
    }
    if (type === "deer_sign" && $("obs-sign-detail")) {
      payload.details.signDetail = $("obs-sign-detail").value || "unknown";
    }
    if (type === "shed_found") {
      payload.details = Object.assign({}, payload.details, {
        side: $("shed-side").value,
        freshness: $("shed-freshness").value,
        antlerCount: Number($("shed-count").value) || 1,
        collected: $("shed-collected").checked
      });
    }
    var mode = els.obsMode.value;
    var result = mode === "edit"
      ? Store.update(els.obsId.value, payload)
      : Store.create(payload);
    if (!result.ok) {
      $("obs-error").textContent = result.error || "Save failed";
      $("obs-error").hidden = false;
      return;
    }
    $("obs-error").hidden = true;
    if (mode !== "edit" && Sessions) {
      var sess = Sessions.getActiveSession() || (state.tracking ? null : null);
      if (state.activeSessionId) {
        Sessions.attachObservation(state.activeSessionId, result.observation.id, type);
      } else if (sess) {
        Sessions.attachObservation(sess.id, result.observation.id, type);
      }
      if (type === "search_completed") {
        Sessions.markCoverage(clickLatLng.lat, clickLatLng.lng, "thorough", {
          sessionId: state.activeSessionId,
          source: "observation"
        });
      }
    }
    closeSheet(els.sheetObs);
    refreshObservations();
    refreshCoverageMarks();
    scheduleRecompute(100);
  }

  function deleteObservation() {
    var id = els.obsId.value;
    if (!id) return;
    if (!window.confirm("Delete this private observation from this device?")) return;
    Store.remove(id);
    closeSheet(els.sheetObs);
    refreshObservations();
    scheduleRecompute(100);
  }

  function openExplain(latlng) {
    var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    var cell = heatLayer && heatLayer.nearestCell(latlng);
    var text;
    state.lastExplainLatLng = latlng;
    var gisGrid = state.lastGrid && state.lastGrid.renderMode === "gis-bands";
    if (gisGrid && (!cell || cell.outsideArea || !cell.result || cell.result.unavailable)) {
      text = state.searchLocation
        ? "Habitat data unavailable for this area — or tap inside the SEARCH AREA circle."
        : "Tap the map to set a SEARCH LOCATION first.";
      if (els.explainBreakdown) els.explainBreakdown.textContent = "";
      if (els.explainTaxonomy) els.explainTaxonomy.textContent = "";
      if (els.explainCompare) els.explainCompare.textContent = "";
      if (els.explainTech) els.explainTech.textContent = "";
      els.explainBody.textContent = text;
      state.lastPerf.explainMs = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0;
      openSheet(els.sheetExplain);
      return;
    }
    if (gisGrid && cell && cell.result && !cell.result.unavailable) {
      var r = cell.result;
      text = (r.label || "Habitat structure") + "\n\nWhy:\n• " + (r.why || []).join("\n• ");
      text += "\n\nEvidence: NLCD land cover · derived edge · USGS slope · private observations (capped).";
      text += "\n\nLimit: landscape structure does not mean an antler is present (~30 m source honesty).";
      if (els.explainBreakdown) {
        els.explainBreakdown.textContent = (r.factors || []).map(function (f) {
          return f.label + ": " + (Math.round((f.contribution || 0) * 1000) / 1000) + " — " + (f.rationale || "");
        }).join(" · ");
      }
      if (els.explainTaxonomy) {
        els.explainTaxonomy.textContent = [
          "Band: " + (r.band && r.band.label) + " (relative score " + (r.score != null ? Math.round(r.score * 100) / 100 : "—") + " — not find %)",
          "Structure: " + (r.structure && r.structure.why),
          "Terrain: " + (r.terrain && r.terrain.why),
          "Observed: " + (r.observed && r.observed.why),
          "NLCD class: " + (r.sample && r.sample.nlcd) + " → " + (r.sample && r.sample.structureLabel),
          "Weights: structure " + HabitatGis.W_STRUCTURE + " · terrain " + HabitatGis.W_TERRAIN + " · observed " + HabitatGis.W_OBSERVED + " (WAYPOINT_HEURISTIC)"
        ].join("\n");
      }
      if (els.explainCompare) {
        els.explainCompare.textContent = "Evidence support — not chance of finding a shed.";
      }
      if (els.explainTech) {
        els.explainTech.textContent = JSON.stringify({
          modelVersion: "habitat-gis-2.0",
          band: r.band,
          score: r.score,
          sample: r.sample,
          factors: r.factors,
          weights: r.weights,
          limitations: r.limitations
        }, null, 2);
      }
      els.explainBody.textContent = text;
      state.lastPerf.explainMs = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0;
      openSheet(els.sheetExplain);
      return;
    }
    if (!cell || !cell.result) {
      text = "No local habitat cell here. Set a SEARCH LOCATION and tap inside the SEARCH AREA.";
      if (els.explainBreakdown) els.explainBreakdown.textContent = "";
      if (els.explainTaxonomy) els.explainTaxonomy.textContent = "";
      if (els.explainCompare) els.explainCompare.textContent = "";
    } else {
      text = Model.explain(cell.result, { coverage: heatLayer.getGrid() && heatLayer.getGrid().coverage });
      if (els.explainBreakdown && cell.result.contributionBreakdown) {
        els.explainBreakdown.textContent = cell.result.contributionBreakdown.map(function (row) {
          return row.label + ": " + (Math.round(row.value * 1000) / 1000) +
            (row.direction ? " (" + row.direction + ")" : "") +
            (row.dataKind ? " [" + row.dataKind + "]" : "");
        }).join(" · ");
      }
      if (els.explainTaxonomy && cell.result.taxonomy) {
        var tax = cell.result.taxonomy;
        var conf = cell.result.confidence || {};
        var inf = cell.result.influences || {};
        els.explainTaxonomy.textContent = [
          "Walk interest: " + cell.band + " (relative score " + (Math.round(cell.priority * 100) / 100) + " — not find probability)",
          "Biological suitability (before search/coverage): " +
            (cell.result.biologicalSuitability != null ? Math.round(cell.result.biologicalSuitability * 100) / 100 : "—"),
          "Positive: " + ((inf.positive || []).map(function (x) { return x.label; }).join("; ") || "none strong"),
          "Limiting: " + ((inf.limiting || []).map(function (x) { return x.label; }).join("; ") || "none strong"),
          "Season: " + ((cell.result.seasonContext && cell.result.seasonContext.phase) || "—"),
          "Observed: " + (tax.observed.join("; ") || "none in range"),
          "Inferred: " + (tax.inferred.join("; ") || "none"),
          "Assumptions: " + (tax.ecologicalAssumptions.join("; ") || "none"),
          "Preferences: " + (tax.userPreferences.join("; ") || "default weights"),
          "Nearby obs: " + ((cell.result.nearbyObservations || []).map(function (n) {
            return n.type + " " + n.distanceM + "m";
          }).join("; ") || "none"),
          "Evidence support (not find probability): bio " + conf.biological +
            " · env " + conf.environmentalData +
            " · obs " + conf.observationDensity +
            " · overall " + conf.overallRecommendation,
          "Model " + cell.result.modelVersion + " / config " + cell.result.factorConfigVersion +
            " / preset " + (cell.result.activePreset || "balanced") +
            " / mode " + (cell.result.inputMode || "?")
        ].join("\n");
      }
      if (els.explainCompare) {
        els.explainCompare.textContent = state.prefs.compareMode
          ? renderCompareSnippet(cell)
          : (state.prefs.diagnosticMode
            ? ("Diagnostic on. Perf coarse/refine ms: " +
              Math.round(state.lastPerf.coarseMs || 0) + "/" +
              Math.round(state.lastPerf.refineMs || 0))
            : "");
      }
      if (els.explainTech) {
        var techPayload = {
          modelVersion: cell.result.modelVersion,
          factorConfigVersion: cell.result.factorConfigVersion,
          band: cell.band,
          priority: Math.round(cell.priority * 100) / 100,
          biologicalSuitability: cell.result.biologicalSuitability,
          coverageLevel: cell.coverageLevel || null,
          influences: cell.result.influences,
          confidence: cell.result.confidence,
          taxonomy: cell.result.taxonomy,
          terrainMeta: cell.result.terrainMeta,
          parts: cell.result.parts,
          sources: cell.result.sources,
          contributionBreakdown: cell.result.contributionBreakdown,
          calibration: cell.result.calibration
        };
        if (!state.prefs.diagnosticMode) {
          delete techPayload.parts;
          delete techPayload.calibration;
        }
        els.explainTech.textContent = JSON.stringify(techPayload, null, 2);
      }
      if ($("btn-validate-here")) {
        $("btn-validate-here").onclick = function () {
          closeSheet(els.sheetExplain);
          openValidationAt(latlng, cell);
        };
      }
    }
    els.explainBody.textContent = text;
    els.explainBody.setAttribute("aria-live", "polite");
    state.lastPerf.explainMs = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0;
    openSheet(els.sheetExplain);
  }

  function renderCompareSnippet(cell) {
    if (!Bio || !cell || !cell.result) return "";
    var balancedPrefs = Store.defaultModelPrefs();
    var base = Bio.scoreCell({
      lat: cell.lat,
      lng: cell.lng,
      date: new Date(),
      prefs: balancedPrefs,
      observations: Store.list(),
      terrain: { slope: null, aspect: null, source: "unavailable", morphology: { source: "unavailable" } },
      weather: state.weather,
      coverageLevel: cell.coverageLevel,
      coverageFactor: cell.result.parts && cell.result.parts.coverageFactor
    });
    var delta = Math.round((cell.priority - base.priority) * 1000) / 1000;
    var changed = [];
    (cell.result.factors || []).forEach(function (f) {
      var bf = null;
      var i;
      for (i = 0; i < (base.factors || []).length; i++) {
        if (base.factors[i].id === f.id) { bf = base.factors[i]; break; }
      }
      if (!bf) return;
      if (Math.abs(f.contribution - bf.contribution) > 0.01) {
        changed.push(f.label + " Δ" + (Math.round((f.contribution - bf.contribution) * 1000) / 1000));
      }
    });
    return "Compare vs balanced baseline at this cell: Δpriority " + delta +
      ". Drivers: " + (changed.slice(0, 5).join("; ") || "near baseline") +
      ". (Transparency tool — not a competitive ranking.)";
  }

  function openValidationAt(latlng, cell) {
    if (!els.sheetValidate) return;
    $("val-lat").value = latlng.lat;
    $("val-lng").value = latlng.lng;
    $("val-error").hidden = true;
    $("val-error").textContent = "";
    if (cell && cell.result) {
      $("val-model-hint").textContent =
        "Snapshot will store model " + cell.result.modelVersion +
        ", band " + cell.band +
        ", relative score " + (Math.round(cell.priority * 100) / 100) +
        ". A no-shed result does not prove the model wrong.";
    }
    openSheet(els.sheetValidate);
  }

  function saveValidation(ev) {
    ev.preventDefault();
    if (!Validation) return;
    var stamp = modelStamp();
    var cell = heatLayer && heatLayer.nearestCell({
      lat: Number($("val-lat").value),
      lng: Number($("val-lng").value)
    });
    var result = Validation.create({
      lat: Number($("val-lat").value),
      lng: Number($("val-lng").value),
      appearedPromising: $("val-promising").value,
      deerSignEncountered: $("val-sign").checked,
      beddingOrFeedingEvidence: $("val-bedfeed").checked,
      accessOrObstacleNotes: $("val-access").value,
      shedOutcome: $("val-shed").value,
      searchEffort: $("val-effort").value,
      confidence: $("val-confidence").value,
      notes: $("val-notes").value,
      modelVersion: stamp.modelVersion,
      factorConfigVersion: stamp.factorConfigVersion,
      activePreset: stamp.activePreset,
      regionalContext: stamp.regionalContext,
      dataCoverageSummary: stamp.dataCoverageSummary,
      inputTimestamp: stamp.inputDataTimestamp,
      cellPriority: cell ? cell.priority : null,
      cellBand: cell ? cell.band : null
    });
    if (!result.ok) {
      $("val-error").hidden = false;
      $("val-error").textContent = result.error || "Could not save.";
      return;
    }
    closeSheet(els.sheetValidate);
  }

  function renderHistory() {
    if (!els.historyBody || !Sessions) return;
    var hist = Sessions.summarizeHistory(Store.list());
    var sessions = Sessions.listSessions().slice(0, 12);
    var lines = [];
    lines.push("Sessions: " + hist.sessionCount + " · Distance logged: " +
      Math.round(hist.totalDistanceM) + " m · Sheds logged in sessions: " + hist.totalShedsFound);
    lines.push("Coverage cells marked: " + hist.coverageCells + " (thorough: " + hist.thoroughCells + ")");
    lines.push("");
    lines.push("Recent sessions:");
    sessions.forEach(function (s) {
      var mins = Math.round((s.durationMs || 0) / 60000);
      lines.push("• " + String(s.startedAt).slice(0, 16).replace("T", " ") +
        " — " + (s.status || "?") + ", " + Math.round(s.distanceM || 0) + " m, " +
        mins + " min, obs " + (s.observationIds || []).length + ", sheds " + (s.shedsFound || 0) +
        (s.modelVersion ? (", model " + s.modelVersion) : ""));
    });
    lines.push("");
    lines.push("Observations by day:");
    hist.days.slice(0, 10).forEach(function (d) {
      lines.push("• " + d.date + ": " + d.count + " notes (" + d.sheds + " shed finds)");
    });
    if (state.lastPlan && state.lastPlan.remainingHighCount != null) {
      lines.push("");
      lines.push("Revisit suggestion: " + state.lastPlan.remainingHighCount +
        " higher-priority pockets in view are not marked thoroughly searched.");
    }
    els.historyBody.textContent = lines.join("\n");
  }

  function openAddObservationFlow() {
    closeAllSheets();
    var ll = state.userLatLng || (map && map.getCenter());
    if (ll) openNewObservation(ll);
  }

  function syncBasemapSelect() {
    var sel = $("basemap-select");
    if (sel && state.basemapId) sel.value = state.basemapId;
  }

  function setBasemapFromUi(id) {
    var Tiles = window.WaypointShedsTiles;
    if (!Tiles || !basemapsBundle || !map) return;
    setTileStatus(null);
    state.basemapId = Tiles.applyBasemap(map, basemapsBundle, id) || "street";
    syncBasemapSelect();
  }

  function shellModeClass(measuring, inspecting) {
    var shell = document.getElementById("sheds-map-shell");
    if (!shell) return;
    shell.classList.toggle("is-measuring", !!measuring);
    shell.classList.toggle("is-inspecting", !!inspecting);
  }

  function ensureMeasureLayer() {
    if (!map) return;
    if (!measureLayer) measureLayer = L.layerGroup().addTo(map);
  }

  function clearMeasureGraphics() {
    if (measureLayer) measureLayer.clearLayers();
    measureLine = null;
  }

  function updateMeasureHud() {
    var distEl = $("measure-dist");
    var areaEl = $("measure-area");
    var hud = $("measure-hud");
    if (!distEl || !hud) return;
    var pts = state.measurePoints || [];
    if (!pts.length) {
      distEl.textContent = "Tap the map to set points";
      if (areaEl) {
        areaEl.setAttribute("hidden", "");
        areaEl.textContent = "";
      }
      return;
    }
    var FT = FieldTools;
    var len = FT ? FT.pathLengthM(pts) : 0;
    var label = FT ? FT.formatFieldDistance(len) : Math.round(len) + " m";
    distEl.textContent =
      pts.length === 1
        ? "Point 1 set — tap next point"
        : pts.length + " points · " + label;
    if (areaEl) {
      if (pts.length >= 3 && FT && FT.polygonAreaM2) {
        var area = FT.polygonAreaM2(pts);
        var areaLabel = FT.formatFieldArea(area);
        if (areaLabel) {
          areaEl.removeAttribute("hidden");
          areaEl.textContent = "Approx. enclosed area: " + areaLabel + " (not survey-grade)";
        } else {
          areaEl.setAttribute("hidden", "");
        }
      } else {
        areaEl.setAttribute("hidden", "");
      }
    }
  }

  function redrawMeasure() {
    ensureMeasureLayer();
    clearMeasureGraphics();
    var pts = state.measurePoints || [];
    var i;
    for (i = 0; i < pts.length; i += 1) {
      L.circleMarker([pts[i].lat, pts[i].lng], {
        radius: 5,
        className: "sheds-measure-vertex",
        color: "#0a1410",
        fillColor: "#d8ec5c",
        fillOpacity: 1,
        weight: 2
      }).addTo(measureLayer);
    }
    if (pts.length >= 2) {
      measureLine = L.polyline(
        pts.map(function (p) {
          return [p.lat, p.lng];
        }),
        { color: "#d8ec5c", weight: 3, opacity: 0.9, dashArray: "6 6" }
      ).addTo(measureLayer);
    }
    updateMeasureHud();
  }

  function startMeasureMode() {
    closeScoutHud();
    closeHuntPlanHud();
    stopHuntSelect({ silent: true });
    stopInspectMode({ silent: true });
    state.measureActive = true;
    state.measurePoints = [];
    ensureMeasureLayer();
    clearMeasureGraphics();
    var hud = $("measure-hud");
    if (hud) hud.removeAttribute("hidden");
    shellModeClass(true, false);
    updateMeasureHud();
    closeAllSheets();
    /* Hide SEARCH prompt while measuring — taps are measure vertices, not SEARCH. */
    var prompt = $("search-prompt");
    if (prompt) prompt.setAttribute("hidden", "");
  }

  function stopMeasureMode() {
    state.measureActive = false;
    state.measurePoints = [];
    clearMeasureGraphics();
    var hud = $("measure-hud");
    if (hud) hud.setAttribute("hidden", "");
    shellModeClass(false, state.inspectArmed);
    if (!state.inspectArmed) syncSearchPrompt();
  }

  function addMeasurePoint(latlng) {
    if (!latlng) return;
    state.measurePoints.push({ lat: latlng.lat, lng: latlng.lng });
    redrawMeasure();
  }

  function undoMeasurePoint() {
    if (!state.measurePoints.length) return;
    state.measurePoints.pop();
    redrawMeasure();
  }

  function clearMeasurePoints() {
    state.measurePoints = [];
    redrawMeasure();
  }

  function stopInspectMode(opts) {
    opts = opts || {};
    state.inspectArmed = false;
    state.inspectLatLng = null;
    state.inspectElevM = null;
    state.inspectElevStatus = "idle";
    state.inspectTerrainDerived = null;
    state.inspectTerrainNeighbors = null;
    state.inspectTerrainStatus = "idle";
    state.inspectReport = null;
    state.inspectElevGen += 1;
    if (inspectMarker && map) {
      try {
        map.removeLayer(inspectMarker);
      } catch (e) { /* */ }
      inspectMarker = null;
    }
    var hud = $("inspect-hud");
    if (hud && !opts.keepHud) hud.setAttribute("hidden", "");
    var scoutActions = $("inspect-scout-actions");
    if (scoutActions && !opts.keepHud) scoutActions.setAttribute("hidden", "");
    shellModeClass(state.measureActive, false);
    if (!state.measureActive) syncSearchPrompt();
  }

  function armInspectMode() {
    closeScoutHud();
    closeHuntPlanHud();
    stopHuntSelect({ silent: true });
    stopMeasureMode();
    state.inspectArmed = true;
    shellModeClass(false, true);
    closeAllSheets();
    var body = $("inspect-body");
    var hud = $("inspect-hud");
    if (body) body.textContent = "Tap the map to inspect a point.";
    if (hud) {
      hud.classList.remove("is-expanded");
      hud.removeAttribute("hidden");
    }
    var scoutActions = $("inspect-scout-actions");
    if (scoutActions) scoutActions.setAttribute("hidden", "");
    var more = $("inspect-more");
    if (more) {
      more.open = false;
      more.hidden = true;
    }
    /* Hide SEARCH prompt while armed — next tap is INSPECT, not SEARCH. */
    var prompt = $("search-prompt");
    if (prompt) prompt.setAttribute("hidden", "");
  }

  function inspectRelationLines() {
    var FT = FieldTools;
    var ll = state.inspectLatLng;
    var fromYou = null;
    var fromSearch = null;
    if (!ll || !FT) return { fromYou: fromYou, fromSearch: fromSearch };
    if (state.userLatLng) {
      var dYou = FT.distanceM(state.userLatLng.lat, state.userLatLng.lng, ll.lat, ll.lng);
      var bYou = FT.bearingDeg(state.userLatLng.lat, state.userLatLng.lng, ll.lat, ll.lng);
      fromYou =
        "From YOU: " +
        FT.formatFieldDistance(dYou) +
        " · " +
        FT.cardinalFromBearing(bYou) +
        " " +
        Math.round(bYou) +
        "°";
    } else {
      fromYou = "From YOU: locate first";
    }
    if (state.searchLocation) {
      var dS = FT.distanceM(state.searchLocation.lat, state.searchLocation.lng, ll.lat, ll.lng);
      var bS = FT.bearingDeg(state.searchLocation.lat, state.searchLocation.lng, ll.lat, ll.lng);
      fromSearch =
        "From SEARCH: " +
        FT.formatFieldDistance(dS) +
        " · " +
        FT.cardinalFromBearing(bS) +
        " " +
        Math.round(bS) +
        "°";
    }
    return { fromYou: fromYou, fromSearch: fromSearch };
  }

  function buildCurrentInspectReport() {
    if (!state.inspectLatLng) return null;
    if (!InspectIntel || !InspectIntel.buildInspectReport) return null;
    var ll = state.inspectLatLng;
    var pack =
      GisPack && state.gisPacks && state.gisPacks.length
        ? GisPack.findCoveringPack(state.gisPacks, ll.lat, ll.lng)
        : null;
    var sample = pack && GisPack.sample ? GisPack.sample(pack, ll.lat, ll.lng) : null;
    var packMeta = null;
    if (pack) {
      var nlcdYear =
        pack.sources && pack.sources.nlcd && (pack.sources.nlcd.year || pack.sources.nlcd.vintage);
      packMeta = { packId: pack.packId, nlcdYear: nlcdYear || 2021, region: pack.region };
    }
    var rel = inspectRelationLines();
    /* Facts only: land-cover sample from the GIS pack; no habitat suitability score. */
    return InspectIntel.buildInspectReport({
      lat: ll.lat,
      lng: ll.lng,
      elevM: state.inspectElevM,
      elevStatus: state.inspectElevStatus,
      terrainStatus: state.inspectTerrainStatus,
      terrainDerived: state.inspectTerrainDerived,
      gisSample: sample,
      packMeta: packMeta,
      fromYou: rel.fromYou,
      fromSearch: rel.fromSearch
    });
  }

  function buildInspectPriority() {
    if (!SearchPriority || !state.inspectLatLng) return null;
    var today = SearchPriority.todayContextFromHunt
      ? SearchPriority.todayContextFromHunt(state.lastHunt)
      : { available: false };
    var derived = state.inspectTerrainDerived || {};
    var nb = state.inspectTerrainNeighbors || {};
    return SearchPriority.evaluatePoint({
      zoom: map ? map.getZoom() : 0,
      elevStatus: state.inspectElevStatus,
      terrainStatus: state.inspectTerrainStatus,
      raw: {
        elevM: typeof derived.elevM === "number" && isFinite(derived.elevM) ? derived.elevM : state.inspectElevM,
        slopeDeg: derived.slopeDeg,
        aspectDeg: derived.aspectDeg,
        northM: nb.northM,
        southM: nb.southM,
        eastM: nb.eastM,
        westM: nb.westM,
        stepM: nb.stepM || 60
      },
      today: today
    });
  }

  function renderInspectHud() {
    var body = $("inspect-body");
    var moreBody = $("inspect-more-body");
    var more = $("inspect-more");
    var hud = $("inspect-hud");
    if (!body || !hud || !state.inspectLatLng) return;
    var report = buildCurrentInspectReport();
    state.inspectReport = report;
    var priority = buildInspectPriority();
    state.inspectPriority = priority;
    var noteEl = $("inspect-field-note");
    function setPriorityHud(text) {
      var raw = String(text || "");
      var idx = raw.lastIndexOf("\nField note\n");
      if (idx >= 0) {
        body.textContent = raw.slice(0, idx).trim();
        if (noteEl) {
          noteEl.textContent = raw.slice(idx + "\nField note\n".length).trim();
          noteEl.hidden = false;
        }
      } else {
        body.textContent = raw;
        if (noteEl) {
          noteEl.textContent = "";
          noteEl.hidden = true;
        }
      }
    }
    if (priority && SearchPriority && SearchPriority.formatInspectHud) {
      setPriorityHud(SearchPriority.formatInspectHud(priority));
    } else if (report) {
      setPriorityHud(report.hudFacts || report.hudText || "");
    } else {
      var ll = state.inspectLatLng;
      var lines = [];
      lines.push(ll.lat.toFixed(5) + ", " + ll.lng.toFixed(5));
      if (state.inspectElevStatus === "loading") lines.push("Elevation: loading…");
      else if (state.inspectElevStatus === "ready" && state.inspectElevM != null) {
        lines.push(
          "Elevation: ~" +
            Math.round(state.inspectElevM) +
            " m (" +
            Math.round(state.inspectElevM * 3.28084) +
            " ft) — network sample"
        );
      } else if (state.inspectElevStatus === "unavailable") lines.push("Elevation: unavailable");
      var rel = inspectRelationLines();
      if (rel.fromYou) lines.push(rel.fromYou);
      if (rel.fromSearch) lines.push(rel.fromSearch);
      lines.push("Context only — not habitat proof.");
      body.textContent = lines.join("\n");
      if (noteEl) {
        noteEl.textContent = "";
        noteEl.hidden = true;
      }
    }
    var moreText = "";
    if (report) {
      moreText = (report.hudFacts ? report.hudFacts + "\n\n" : "") + (report.hudExplain || "");
    }
    if (moreBody) moreBody.textContent = moreText;
    if (more) {
      more.hidden = !String(moreText).trim();
    }
    hud.removeAttribute("hidden");
    var scoutActions = $("inspect-scout-actions");
    if (scoutActions) {
      if (state.inspectLatLng) scoutActions.removeAttribute("hidden");
      else scoutActions.setAttribute("hidden", "");
    }
    syncSearchPrompt();
  }

  function revealInspectPoint(latlng) {
    if (!map || !latlng) return;
    var hud = $("inspect-hud");
    var mapEl = document.getElementById("sheds-map");
    if (!hud || !mapEl || hud.hasAttribute("hidden")) return;
    try {
      var mapBox = mapEl.getBoundingClientRect();
      var hudBox = hud.getBoundingClientRect();
      var pt = map.latLngToContainerPoint(L.latLng(latlng.lat, latlng.lng));
      var minY = Math.max(0, hudBox.bottom - mapBox.top) + 28;
      var maxY = Math.max(minY + 24, mapBox.height - 80);
      var minX = 16;
      var maxX = Math.max(minX + 24, mapBox.width - 64);
      var dx = 0;
      var dy = 0;
      if (pt.y < minY) dy = minY - pt.y;
      else if (pt.y > maxY) dy = maxY - pt.y;
      if (pt.x > maxX) dx = maxX - pt.x;
      else if (pt.x < minX) dx = minX - pt.x;
      if (dx || dy) map.panBy([dx, dy], { animate: false });
    } catch (e) { /* */ }
  }

  function fetchInspectElevation(lat, lng, gen) {
    state.inspectElevStatus = "loading";
    state.inspectElevM = null;
    renderInspectHud();
    if (state.offlineForced || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      state.inspectElevStatus = "unavailable";
      state.inspectElevM = null;
      renderInspectHud();
      return;
    }
    var url =
      "https://api.open-meteo.com/v1/elevation?latitude=" +
      encodeURIComponent(lat.toFixed(5)) +
      "&longitude=" +
      encodeURIComponent(lng.toFixed(5));
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (ctrl) {
      timer = setTimeout(function () {
        try {
          ctrl.abort();
        } catch (e) { /* */ }
      }, 8000);
    }
    fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (res) {
        if (!res.ok) throw new Error("elev " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        if (gen !== state.inspectElevGen) return;
        var elev = data && data.elevation && data.elevation[0];
        if (elev == null || !isFinite(elev)) {
          state.inspectElevStatus = "unavailable";
          state.inspectElevM = null;
        } else {
          state.inspectElevStatus = "ready";
          state.inspectElevM = elev;
        }
        renderInspectHud();
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        if (gen !== state.inspectElevGen) return;
        state.inspectElevStatus = "failed";
        state.inspectElevM = null;
        renderInspectHud();
      });
  }

  /** Neighborhood elev → derived slope/aspect for Inspect (physical geography). */
  function fetchInspectTerrain(lat, lng, gen) {
    state.inspectTerrainStatus = "loading";
    state.inspectTerrainDerived = null;
    state.inspectTerrainNeighbors = null;
    renderInspectHud();
    if (!InspectIntel || !InspectIntel.elevationNeighborhoodUrl) {
      state.inspectTerrainStatus = "unavailable";
      renderInspectHud();
      return;
    }
    if (state.offlineForced || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      state.inspectTerrainStatus = "unavailable";
      renderInspectHud();
      return;
    }
    var nb = InspectIntel.elevationNeighborhoodUrl(lat, lng);
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (ctrl) {
      timer = setTimeout(function () {
        try {
          ctrl.abort();
        } catch (e) { /* */ }
      }, 8000);
    }
    fetch(nb.url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (res) {
        if (!res.ok) throw new Error("terrain elev " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        if (gen !== state.inspectElevGen) return;
        var elev = (data && data.elevation) || [];
        var derived = InspectIntel.terrainFromElevationArray(elev, nb.stepM);
        if (!derived || derived.slopeDeg == null) {
          state.inspectTerrainStatus = "unavailable";
          state.inspectTerrainDerived = null;
          state.inspectTerrainNeighbors = null;
        } else {
          state.inspectTerrainStatus = "ready";
          state.inspectTerrainDerived = derived;
          state.inspectTerrainNeighbors = {
            centerM: elev[0],
            northM: elev[1],
            southM: elev[2],
            eastM: elev[3],
            westM: elev[4],
            stepM: nb.stepM
          };
          if (state.inspectElevStatus !== "ready" && derived.elevM != null) {
            state.inspectElevStatus = "ready";
            state.inspectElevM = derived.elevM;
          }
        }
        renderInspectHud();
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        if (gen !== state.inspectElevGen) return;
        state.inspectTerrainStatus = "failed";
        state.inspectTerrainDerived = null;
        state.inspectTerrainNeighbors = null;
        renderInspectHud();
      });
  }

  function showInspectAt(latlng) {
    if (!latlng || !map) return;
    /* Stay in Inspect until Done so walking taps re-inspect instead of setting SEARCH. */
    state.inspectArmed = true;
    state.inspectLatLng = { lat: latlng.lat, lng: latlng.lng };
    state.inspectTerrainDerived = null;
    state.inspectTerrainNeighbors = null;
    state.inspectTerrainStatus = "idle";
    state.inspectReport = null;
    state.inspectPriority = null;
    shellModeClass(false, true);
    var scoutActions = $("inspect-scout-actions");
    if (scoutActions) scoutActions.removeAttribute("hidden");
    var hud = $("inspect-hud");
    var more = $("inspect-more");
    if (more) {
      more.open = false;
      more.hidden = false;
    }
    if (hud) hud.classList.remove("is-expanded");
    if (inspectMarker) {
      try {
        map.removeLayer(inspectMarker);
      } catch (e) { /* */ }
    }
    inspectMarker = L.circleMarker([latlng.lat, latlng.lng], {
      radius: 7,
      color: "#f0c14a",
      fillColor: "#f0c14a",
      fillOpacity: 0.9,
      weight: 2,
      className: "sheds-inspect-marker"
    }).addTo(map);
    try {
      inspectMarker.bindTooltip("INSPECT — location facts (not YOU, not SEARCH, not OBS)", {
        permanent: false,
        direction: "top",
        className: "sheds-inspect-tip"
      });
    } catch (e2) { /* */ }
    var gen = ++state.inspectElevGen;
    ensureGisPacks().then(function () {
      if (gen !== state.inspectElevGen) return;
      renderInspectHud();
    });
    fetchInspectElevation(latlng.lat, latlng.lng, gen);
    fetchInspectTerrain(latlng.lat, latlng.lng, gen);
    renderInspectHud();
    setTimeout(function () {
      if (gen !== state.inspectElevGen) return;
      revealInspectPoint(latlng);
    }, 50);
  }

  function bindControls() {
    $("btn-locate").addEventListener("click", function () { locateUser({ center: true, force: true }); });
    if ($("btn-here-chip")) {
      $("btn-here-chip").addEventListener("click", function () { locateUser({ center: true, force: true }); });
    }
    if ($("btn-zoom-in")) {
      $("btn-zoom-in").addEventListener("click", function () {
        if (map) map.zoomIn();
      });
    }
    if ($("btn-zoom-out")) {
      $("btn-zoom-out").addEventListener("click", function () {
        if (map) map.zoomOut();
      });
    }
    els.btnTrack = $("btn-track");
    if (els.btnTrack) {
      els.btnTrack.addEventListener("click", function () {
        if (state.tracking) stopTracking();
        else startTracking();
      });
    }
    els.btnMore = $("btn-more");
    if (els.btnMore) {
      els.btnMore.addEventListener("click", function () {
        openSheet(els.sheetTools);
      });
    }
    if ($("btn-layers")) {
      $("btn-layers").addEventListener("click", function () {
        closeSheet(els.sheetTools);
        syncControlsForm();
        openSheet(els.sheetControls);
      });
    }
    if ($("basemap-select")) {
      $("basemap-select").addEventListener("change", function () {
        setBasemapFromUi($("basemap-select").value);
      });
    }
    if ($("btn-measure")) {
      $("btn-measure").addEventListener("click", function () {
        startMeasureMode();
      });
    }
    if ($("btn-inspect-point")) {
      $("btn-inspect-point").addEventListener("click", function () {
        armInspectMode();
      });
    }
    if ($("btn-measure-done")) {
      $("btn-measure-done").addEventListener("click", function () {
        stopMeasureMode();
      });
    }
    if ($("btn-measure-clear")) {
      $("btn-measure-clear").addEventListener("click", function () {
        clearMeasurePoints();
      });
    }
    if ($("btn-measure-undo")) {
      $("btn-measure-undo").addEventListener("click", function () {
        undoMeasurePoint();
      });
    }
    if ($("btn-inspect-close")) {
      $("btn-inspect-close").addEventListener("click", function () {
        stopInspectMode();
      });
    }
    if ($("inspect-more")) {
      $("inspect-more").addEventListener("toggle", function () {
        var hud = $("inspect-hud");
        var more = $("inspect-more");
        if (hud && more) hud.classList.toggle("is-expanded", !!more.open);
      });
    }
    if ($("btn-add-obs")) {
      $("btn-add-obs").addEventListener("click", openAddObservationFlow);
    }
    if ($("btn-add-obs-fab")) {
      $("btn-add-obs-fab").addEventListener("click", openAddObservationFlow);
    }
    if ($("btn-obs-use-gps")) {
      $("btn-obs-use-gps").addEventListener("click", function () {
        locateUser({
          center: false,
          force: true,
          onSuccess: function (ll) {
            if (Store.canPlaceFromGps && !Store.canPlaceFromGps(state.accuracyM)) {
              var hint = $("obs-location-hint");
              if (hint) {
                hint.textContent = "YOU is too approximate (±" +
                  (state.accuracyM != null ? Math.round(state.accuracyM) + " m" : "?") +
                  ") — tap the map to place this observation.";
              }
              return;
            }
            clickLatLng = ll;
            syncObsLocationHint();
          }
        });
        if (state.userLatLng && state.locationStatus === "available") {
          if (Store.canPlaceFromGps && !Store.canPlaceFromGps(state.accuracyM)) {
            var hint2 = $("obs-location-hint");
            if (hint2) {
              hint2.textContent = "YOU is too approximate (±" +
                (state.accuracyM != null ? Math.round(state.accuracyM) + " m" : "?") +
                ") — tap the map to place this observation.";
            }
            return;
          }
          clickLatLng = state.userLatLng;
          syncObsLocationHint();
        }
      });
    }
    if ($("btn-status")) {
      $("btn-status").addEventListener("click", function () {
        var panel = $("status-panel");
        if (!panel) return;
        var open = panel.hasAttribute("hidden");
        if (open) panel.removeAttribute("hidden");
        else panel.setAttribute("hidden", "");
        $("btn-status").setAttribute("aria-expanded", open ? "true" : "false");
        invalidateMapSize();
      });
    }
    if ($("btn-toggle-plan")) {
      els.btnTogglePlan = $("btn-toggle-plan");
      els.btnTogglePlan.addEventListener("click", function () {
        setPlanExpanded(!state.planExpanded);
      });
    }
    if ($("btn-recenter")) {
      $("btn-recenter").addEventListener("click", function () {
        if (!state.userLatLng || !map) return;
        recenterToUser({ zoom: Math.max(map.getZoom(), 13) });
        syncRecenterBtn();
        closeAllSheets();
      });
    }
    $("btn-controls").addEventListener("click", function () {
      closeSheet(els.sheetTools);
      syncControlsForm();
      openSheet(els.sheetControls);
    });
    $("btn-ethics").addEventListener("click", function () { openSheet(els.sheetEthics); });
    $("btn-explain").addEventListener("click", function () {
      openExplain(map.getCenter());
    });
    if ($("btn-history")) {
      $("btn-history").addEventListener("click", function () {
        renderHistory();
        openSheet(els.sheetHistory);
      });
    }
    if ($("btn-validate")) {
      $("btn-validate").addEventListener("click", function () {
        var ll = state.userLatLng || map.getCenter();
        var cell = heatLayer && heatLayer.nearestCell(ll);
        openValidationAt(ll, cell);
      });
    }
    if ($("val-form")) {
      $("val-form").addEventListener("submit", saveValidation);
    }
    if ($("btn-goto-plan")) {
      $("btn-goto-plan").addEventListener("click", function () {
        if (state.lastPlan && state.lastPlan.recommendation) {
          var r = state.lastPlan.recommendation;
          state.followUser = false;
          map.setView([r.lat, r.lng], Math.max(map.getZoom(), 14));
          syncRecenterBtn();
          setPlanExpanded(false);
        }
      });
    }
    ["partial", "thorough", "revisit"].forEach(function (level) {
      var btn = $("btn-mark-" + level);
      if (btn) btn.addEventListener("click", function () { markCoverageAtUser(level); });
    });

    if ($("btn-save-area")) {
      $("btn-save-area").addEventListener("click", function () {
        closeAllSheets();
        promptSaveSearchArea();
      });
    }
    if ($("btn-my-areas")) {
      $("btn-my-areas").addEventListener("click", function () {
        closeAllSheets();
        refreshAreasList();
        openSheet($("sheet-areas"));
      });
    }
    if ($("btn-scout-spots")) {
      $("btn-scout-spots").addEventListener("click", function () {
        closeAllSheets();
        refreshScoutList();
        openSheet($("sheet-scout-spots"));
      });
    }
    if ($("btn-scout-create-plan")) {
      $("btn-scout-create-plan").addEventListener("click", function () {
        closeAllSheets();
        startHuntSelect([]);
      });
    }
    if ($("btn-hunt-plans")) {
      $("btn-hunt-plans").addEventListener("click", function () {
        closeAllSheets();
        refreshHuntPlanList();
        openSheet($("sheet-hunt-plans"));
      });
    }
    if ($("btn-hunt-plans-create")) {
      $("btn-hunt-plans-create").addEventListener("click", function () {
        closeAllSheets();
        startHuntSelect([]);
      });
    }
    if ($("btn-hunt-select-create")) {
      $("btn-hunt-select-create").addEventListener("click", function () {
        promptNameHuntPlan(state.huntSelectIds);
      });
    }
    if ($("btn-hunt-select-cancel")) {
      $("btn-hunt-select-cancel").addEventListener("click", function () {
        stopHuntSelect();
      });
    }
    if ($("btn-hunt-plan-name-save")) {
      $("btn-hunt-plan-name-save").addEventListener("click", saveNamedHuntPlan);
    }
    if ($("btn-choose-plan-new")) {
      $("btn-choose-plan-new").addEventListener("click", function () {
        if (!state.scoutSpotId) return;
        closeSheetQuiet($("sheet-choose-hunt-plan"));
        promptNameHuntPlan([state.scoutSpotId]);
      });
    }
    if ($("btn-hunt-plan-close")) {
      $("btn-hunt-plan-close").addEventListener("click", function () {
        closeHuntPlanHud();
      });
    }
    if ($("btn-hunt-plan-delete")) {
      $("btn-hunt-plan-delete").addEventListener("click", function () {
        if (!HuntPlans || !state.huntPlanId) return;
        if (!window.confirm("Delete this Hunt Plan from this device? Scout Spots are kept.")) return;
        HuntPlans.remove(state.huntPlanId);
        closeHuntPlanHud();
        refreshHuntPlanList();
      });
    }
    if ($("hunt-plan-name")) {
      $("hunt-plan-name").addEventListener("change", function () {
        if (!HuntPlans || !state.huntPlanId) return;
        var result = HuntPlans.rename(state.huntPlanId, $("hunt-plan-name").value);
        if (result.ok) renderHuntPlanHud(result.plan);
        else {
          var current = HuntPlans.getById(state.huntPlanId);
          if (current) $("hunt-plan-name").value = current.name || "";
        }
      });
    }
    if ($("hunt-plan-note")) {
      $("hunt-plan-note").addEventListener("change", function () {
        if (!HuntPlans || !state.huntPlanId) return;
        var result = HuntPlans.setNote(state.huntPlanId, $("hunt-plan-note").value);
        if (result.ok) renderHuntPlanHud(result.plan);
      });
    }
    document.querySelectorAll("[data-hunt-plan-status]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!HuntPlans || !state.huntPlanId) return;
        var result = HuntPlans.setStatus(state.huntPlanId, btn.getAttribute("data-hunt-plan-status"));
        if (result.ok) renderHuntPlanHud(result.plan);
      });
    });
    if ($("btn-save-scout-spot")) {
      $("btn-save-scout-spot").addEventListener("click", function () {
        saveScoutSpotFromInspect();
      });
    }
    if ($("btn-scout-close")) {
      $("btn-scout-close").addEventListener("click", function () {
        closeScoutHud();
      });
    }
    if ($("btn-scout-delete")) {
      $("btn-scout-delete").addEventListener("click", function () {
        if (!ScoutStore || !state.scoutSpotId) return;
        if (!window.confirm("Delete this Scout Spot from this device? This does not delete map terrain.")) return;
        ScoutStore.remove(state.scoutSpotId);
        closeScoutHud();
        refreshScoutSpots();
        refreshHuntPlanList();
        if (state.huntPlanId && HuntPlans) {
          var still = HuntPlans.getById(state.huntPlanId);
          if (still) renderHuntPlanHud(still);
        }
      });
    }
    if ($("btn-scout-add-plan")) {
      $("btn-scout-add-plan").addEventListener("click", function () {
        if (!state.scoutSpotId) return;
        addScoutToHuntPlan(state.scoutSpotId);
      });
    }
    if ($("scout-name")) {
      $("scout-name").addEventListener("change", function () {
        if (!ScoutStore || !state.scoutSpotId) return;
        var result = ScoutStore.rename(state.scoutSpotId, $("scout-name").value);
        if (result.ok) {
          renderScoutHud(result.spot);
          refreshScoutSpots();
        } else {
          var current = ScoutStore.getById(state.scoutSpotId);
          if (current) $("scout-name").value = current.name || "";
        }
      });
    }
    if ($("scout-note")) {
      $("scout-note").addEventListener("change", function () {
        if (!ScoutStore || !state.scoutSpotId) return;
        var result = ScoutStore.setNote(state.scoutSpotId, $("scout-note").value);
        if (result.ok) renderScoutHud(result.spot);
      });
    }
    document.querySelectorAll("[data-scout-status]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!ScoutStore || !state.scoutSpotId) return;
        var result = ScoutStore.setStatus(state.scoutSpotId, btn.getAttribute("data-scout-status"));
        if (result.ok) {
          renderScoutHud(result.spot);
          refreshScoutSpots();
        }
      });
    });
    if ($("btn-field-plan")) {
      $("btn-field-plan").addEventListener("click", function () {
        closeAllSheets();
        openFieldPlanSheet();
      });
    }
    if ($("btn-field-plan-fab")) {
      $("btn-field-plan-fab").addEventListener("click", function () {
        openFieldPlanSheet();
      });
    }
    if ($("btn-open-field-plan")) {
      $("btn-open-field-plan").addEventListener("click", function () {
        openFieldPlanSheet();
      });
    }
    if ($("btn-end-search-strip")) {
      $("btn-end-search-strip").addEventListener("click", function () {
        if (state.tracking) stopTracking();
      });
    }
    if ($("btn-heat-legend-toggle")) {
      $("btn-heat-legend-toggle").addEventListener("click", function () {
        var legend = $("heat-legend");
        if (!legend || legend.hidden) return;
        var open = legend.getAttribute("data-expanded") === "true";
        legend.setAttribute("data-expanded", open ? "false" : "true");
        $("btn-heat-legend-toggle").setAttribute("aria-expanded", open ? "false" : "true");
      });
    }
    if ($("btn-map-legend")) {
      $("btn-map-legend").addEventListener("click", function () {
        toggleMapLegend();
      });
    }
    if ($("btn-save-area-confirm")) {
      $("btn-save-area-confirm").addEventListener("click", confirmSaveSearchArea);
    }
    if ($("btn-field-plan-start")) {
      $("btn-field-plan-start").addEventListener("click", function () {
        closeSheetQuiet($("sheet-field-plan"));
        if (!state.tracking) startTracking();
      });
    }
    if ($("include-obs-habitat")) {
      $("include-obs-habitat").addEventListener("change", function () {
        state.prefs.includeObservationsInHabitat = !!$("include-obs-habitat").checked;
        Store.saveModelPrefs(state.prefs);
        syncGuidanceModeLabel();
        scheduleRecompute(120);
      });
    }
    $("btn-export").addEventListener("click", function () {
      var payload = {
        format: "waypoint-sheds-field-private-v1",
        observations: Store.exportJson(),
        sessions: Sessions ? Sessions.exportBundle() : null,
        searchAreas: AreaStore ? AreaStore.exportJson() : null,
        scoutSpots: ScoutStore ? ScoutStore.exportJson() : null,
        huntPlans: HuntPlans ? HuntPlans.exportJson() : null,
        validations: Validation ? Validation.list() : [],
        finds: window.WaypointSheds && WaypointSheds.listFinds ? WaypointSheds.listFinds() : [],
        modelPrefs: state.prefs,
        modelStamp: modelStamp(),
        privacyNote:
          "Observations, sessions, Scout Spots, Hunt Plans, and validations were stored on-device. " +
          "Tile/weather providers may have received approximate map/request location during use."
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sheds-field-private.json";
      a.click();
      URL.revokeObjectURL(a.href);
      closeAllSheets();
    });

    if ($("btn-import") && $("import-json-file")) {
      $("btn-import").addEventListener("click", function () {
        $("import-json-file").click();
      });
      $("import-json-file").addEventListener("change", function () {
        var input = $("import-json-file");
        var file = input.files && input.files[0];
        input.value = "";
        if (!file) return;
        var Importer = window.WaypointShedsImport;
        if (!Importer) {
          window.alert("Import is not available in this build.");
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          var parsed = Importer.parseExport(String(reader.result || ""));
          if (!parsed.ok) {
            window.alert(parsed.error || "Could not read that file.");
            return;
          }
          var result = Importer.importPayload(parsed);
          if (!result.ok) {
            window.alert(result.error || "Import failed.");
            return;
          }
          try { refreshObservations(); } catch (e1) { /* map may not be ready */ }
          try { refreshAreasList(); } catch (e2) { /* */ }
          try { refreshScoutSpots(); } catch (eScout) { /* */ }
          try { refreshHuntPlanList(); } catch (ePlan) { /* */ }
          try { scheduleRecompute(80); } catch (e3) { /* */ }
          var c = result.counts || {};
          function tally(section) {
            if (!section) return "0 added";
            return (section.added || 0) + " added, " +
              (section.replaced || 0) + " replaced, " +
              (section.skipped || 0) + " skipped";
          }
          window.alert(
            "Imported private field records into this browser only. " +
              "Notes: " + tally(c.observations) + ". " +
              "Search areas: " + tally(c.searchAreas) + ". " +
              "Scout Spots: " + tally(c.scoutSpots) + ". " +
              "Hunt Plans: " + tally(c.huntPlans) + ". " +
              "Sessions: " + tally(c.sessions) + ". " +
              "This does not prove a find or copy data from another website."
          );
          closeAllSheets();
        };
        reader.readAsText(file);
      });
    }

    document.querySelectorAll("[data-close-sheet]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeSheet(btn.closest(".sheds-sheet"));
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeAllSheets();
        closeScoutHud();
        closeHuntPlanHud();
        stopHuntSelect();
      }
    });

    $("obs-type").addEventListener("change", function () {
      toggleObsExtras($("obs-type").value);
    });
    els.obsForm.addEventListener("submit", saveObservation);
    $("obs-delete").addEventListener("click", deleteObservation);

    $("heat-visible").addEventListener("change", function () {
      state.prefs.heatVisible = $("heat-visible").checked;
      if (heatLayer) heatLayer.setHeatVisible(!!state.prefs.heatVisible);
      Store.saveModelPrefs(state.prefs);
      syncHeatLegend();
      scheduleRecompute(50);
    });
    if ($("search-areas-visible")) {
      $("search-areas-visible").addEventListener("change", function () {
        setSearchAreasVisible($("search-areas-visible").checked);
      });
    }
    if ($("btn-search-areas")) {
      $("btn-search-areas").addEventListener("click", function () {
        setSearchAreasVisible(!state.searchAreasVisible);
      });
    }
    function readHeatFilterControls() {
      state.heatMode = $("heat-mode") ? $("heat-mode").value : "habitat";
      if (state.heatMode === "biological") state.heatMode = "habitat";
      state.heatFilters = {
        timeOfDay: $("heat-tod") ? $("heat-tod").value : "all",
        season: $("heat-season") ? $("heat-season").value : "all",
        weather: $("heat-wx") ? $("heat-wx").value : "any",
        rangeDays: $("heat-range") ? $("heat-range").value : "all"
      };
      try {
        localStorage.setItem("waypoint-sheds-heat-ui-v1", JSON.stringify({
          heatMode: state.heatMode,
          heatFilters: state.heatFilters
        }));
      } catch (e) { /* ignore */ }
    }
    ["heat-mode", "heat-tod", "heat-season", "heat-wx", "heat-range"].forEach(function (id) {
      if (!$(id)) return;
      $(id).addEventListener("change", function () {
        readHeatFilterControls();
        syncHeatLegend();
        scheduleRecompute(80);
      });
    });
    $("obs-visible").addEventListener("change", function () {
      state.prefs.obsVisible = $("obs-visible").checked;
      Store.saveModelPrefs(state.prefs);
      refreshObservations();
    });
    $("heat-opacity").addEventListener("input", function () {
      state.prefs.opacity = Number($("heat-opacity").value);
      Store.saveModelPrefs(state.prefs);
      if (heatLayer) heatLayer.setHeatOpacity(state.prefs.opacity);
      if ($("heat-opacity-val")) {
        $("heat-opacity-val").textContent = Math.round(state.prefs.opacity * 100) + "%";
      }
    });
    if ($("confidence-overlay")) {
      $("confidence-overlay").addEventListener("change", function () {
        state.prefs.showConfidence = $("confidence-overlay").checked;
        Store.saveModelPrefs(state.prefs);
        if (heatLayer && heatLayer.setShowConfidence) heatLayer.setShowConfidence(state.prefs.showConfidence);
      });
    }
    if ($("coverage-visible")) {
      $("coverage-visible").addEventListener("change", function () {
        state.prefs.coverageVisible = $("coverage-visible").checked;
        Store.saveModelPrefs(state.prefs);
        refreshCoverageMarks();
      });
    }
    if ($("diagnostic-mode")) {
      $("diagnostic-mode").addEventListener("change", function () {
        state.prefs.diagnosticMode = $("diagnostic-mode").checked;
        Store.saveModelPrefs(state.prefs);
      });
    }
    if ($("compare-mode")) {
      $("compare-mode").addEventListener("change", function () {
        state.prefs.compareMode = $("compare-mode").checked;
        Store.saveModelPrefs(state.prefs);
      });
    }
    if ($("offline-forced")) {
      $("offline-forced").addEventListener("change", function () {
        state.offlineForced = $("offline-forced").checked;
        syncOfflineBanner();
        scheduleRecompute(80);
      });
    }
    if ($("model-preset") && Presets) {
      $("model-preset").addEventListener("change", function () {
        var before = state.prefs;
        state.prefs = Presets.applyPreset(state.prefs, $("model-preset").value);
        Store.saveModelPrefs(state.prefs);
        syncControlsForm();
        var changed = Presets.changedWeightKeys(before, state.prefs);
        if ($("preset-hint")) {
          var p = Presets.getPreset(state.prefs.activePreset);
          $("preset-hint").textContent = p.summary +
            (changed.length ? " Changed: " + changed.join(", ") + "." : "") +
            " Presets explore emphasis — they are not universal truth.";
        }
        scheduleRecompute(120);
      });
    }
    if ($("season-override") && Bio) {
      $("season-override").addEventListener("change", function () {
        var v = $("season-override").value;
        state.prefs.seasonPhaseOverride = v === "auto" ? null : v;
        if (state.prefs.activePreset === "balanced") {
          /* keep */
        }
        Store.saveModelPrefs(state.prefs);
        updateSeasonPill();
        scheduleRecompute(120);
      });
    }

    document.querySelectorAll("[data-weight]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        state.prefs.weights[sel.getAttribute("data-weight")] = sel.value;
        state.prefs.activePreset = "custom";
        if ($("model-preset")) $("model-preset").value = "balanced";
        Store.saveModelPrefs(state.prefs);
        scheduleRecompute(120);
      });
    });

    $("btn-reset-weights").addEventListener("click", function () {
      state.prefs = Presets ? Presets.applyPreset(null, "balanced") : Store.defaultModelPrefs();
      Store.saveModelPrefs(state.prefs);
      syncControlsForm();
      scheduleRecompute(50);
    });

    $("obs-filter").addEventListener("change", function () {
      var val = $("obs-filter").value;
      if (val === "all") state.filterTypes = null;
      else state.filterTypes = new Set([val]);
      refreshObservations();
    });

    function onRadiusChange(ev) {
      var v = ev.target.value;
      state.searchRadiusKey = v === "small" || v === "large" ? v : "medium";
      if ($("search-radius")) $("search-radius").value = state.searchRadiusKey;
      if ($("search-radius-tools")) $("search-radius-tools").value = state.searchRadiusKey;
      drawSearchOnMap();
      scheduleRecompute(80);
    }
    if ($("search-radius")) $("search-radius").addEventListener("change", onRadiusChange);
    if ($("search-radius-tools")) $("search-radius-tools").addEventListener("change", onRadiusChange);
    if ($("btn-analyze-you")) {
      $("btn-analyze-you").addEventListener("click", function () {
        if (!state.userLatLng) return;
        var ok = SearchArea
          ? SearchArea.canAnalyzeAtYou(state.accuracyM)
          : state.accuracyM != null && state.accuracyM <= SEARCH_YOU_ACCURACY_MAX_M;
        if (!ok) {
          syncSearchPrompt();
          return;
        }
        setSearchLocation(state.userLatLng.lat, state.userLatLng.lng, "analyze-at-you");
      });
    }
    if ($("sgl-visible")) {
      $("sgl-visible").addEventListener("change", function () {
        state.sglVisible = !!$("sgl-visible").checked;
        refreshSglOverlay();
      });
    }

    map.on("contextmenu", function (e) {
      L.DomEvent.preventDefault(e);
      openExplain(e.latlng);
    });
  }

  function syncControlsForm() {
    $("heat-visible").checked = state.prefs.heatVisible;
    if ($("search-areas-visible")) $("search-areas-visible").checked = !!state.searchAreasVisible;
    $("obs-visible").checked = state.prefs.obsVisible;
    $("heat-opacity").value = state.prefs.opacity;
    if ($("heat-opacity-val")) {
      $("heat-opacity-val").textContent = Math.round(Number(state.prefs.opacity) * 100) + "%";
    }
    if ($("confidence-overlay")) $("confidence-overlay").checked = !!state.prefs.showConfidence;
    if ($("coverage-visible")) $("coverage-visible").checked = state.prefs.coverageVisible !== false;
    if ($("sgl-visible")) $("sgl-visible").checked = !!state.sglVisible;
    if ($("search-radius")) $("search-radius").value = state.searchRadiusKey || "medium";
    if ($("search-radius-tools")) $("search-radius-tools").value = state.searchRadiusKey || "medium";
    syncBasemapSelect();
    if ($("diagnostic-mode")) $("diagnostic-mode").checked = !!state.prefs.diagnosticMode;
    if ($("compare-mode")) $("compare-mode").checked = !!state.prefs.compareMode;
    if ($("include-obs-habitat")) $("include-obs-habitat").checked = !!state.prefs.includeObservationsInHabitat;
    syncGuidanceModeLabel();
    if ($("offline-forced")) $("offline-forced").checked = !!state.offlineForced;
    if ($("heat-mode")) $("heat-mode").value = state.heatMode === "biological" ? "habitat" : (state.heatMode || "habitat");
    var hf = state.heatFilters || {};
    if ($("heat-tod")) $("heat-tod").value = hf.timeOfDay || "all";
    if ($("heat-season")) $("heat-season").value = hf.season || "all";
    if ($("heat-wx")) $("heat-wx").value = hf.weather || "any";
    if ($("heat-range")) $("heat-range").value = hf.rangeDays || "all";
    if ($("model-preset") && Presets) {
      var pid = state.prefs.activePreset || "balanced";
      if (!Presets.PRESETS[pid]) pid = "balanced";
      $("model-preset").value = pid;
      if ($("preset-hint")) $("preset-hint").textContent = Presets.getPreset(pid).summary;
    }
    if ($("season-override")) {
      $("season-override").value = state.prefs.seasonPhaseOverride || "auto";
    }
    Object.keys(state.prefs.weights).forEach(function (k) {
      var el = document.querySelector('[data-weight="' + k + '"]');
      if (el) el.value = state.prefs.weights[k];
    });
  }

  function loadHeatUiPrefs() {
    try {
      var raw = localStorage.getItem("waypoint-sheds-heat-ui-v1");
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed.heatMode === "observed" || parsed.heatMode === "biological" || parsed.heatMode === "habitat") {
        state.heatMode = parsed.heatMode === "biological" ? "habitat" : parsed.heatMode;
      }
      if (parsed.heatFilters && typeof parsed.heatFilters === "object") {
        state.heatFilters = parsed.heatFilters;
      }
    } catch (e) { /* ignore */ }
  }

  function fillTypeSelects() {
    var opts = Store.OBSERVATION_TYPES.map(function (t) {
      return "<option value=\"" + t.id + "\">" + t.label + "</option>";
    }).join("");
    $("obs-type").innerHTML = opts;
    $("obs-filter").innerHTML = "<option value=\"all\">All observations</option>" + opts;
  }

  function maybeEthics() {
    try {
      if (localStorage.getItem("waypoint-sheds-ethics-seen-v1")) return;
    } catch (e) { return; }
    openSheet(els.sheetEthics);
  }

  function onEthicsAck() {
    try { localStorage.setItem("waypoint-sheds-ethics-seen-v1", "1"); } catch (e) { /* */ }
    closeSheet(els.sheetEthics);
  }

  function boot() {
    if (!window.L || !Store || !Model || !Heat || !Sessions || !Planner || !Bio || !Presets || !Validation || !Patterns || !TodaysSearch) {
      requestAnimationFrame(boot);
      return;
    }
    els.locStatus = $("loc-status");
    els.obsCount = $("obs-count");
    els.coverage = $("coverage-pill");
    els.sessionPill = $("session-pill");
    els.seasonPill = $("season-pill");
    els.modelNote = $("model-note");
    els.inputsSummary = $("inputs-summary");
    els.planCard = $("plan-card");
    els.planTitle = $("plan-title");
    els.planBody = $("plan-body");
    els.planWhy = $("plan-why");
    els.planMeta = $("plan-meta");
    els.planGlance = $("plan-glance");
    els.planDetails = $("plan-details");
    els.btnTogglePlan = $("btn-toggle-plan");
    els.sheetObs = $("sheet-obs");
    els.sheetControls = $("sheet-controls");
    els.sheetExplain = $("sheet-explain");
    els.sheetEthics = $("sheet-ethics");
    els.sheetHistory = $("sheet-history");
    els.sheetValidate = $("sheet-validate");
    els.sheetTools = $("sheet-tools");
    els.btnMore = $("btn-more");
    els.historyBody = $("history-body");
    els.obsForm = $("obs-form");
    els.obsId = $("obs-id");
    els.obsMode = $("obs-mode");
    els.explainBody = $("explain-body");
    els.explainTech = $("explain-tech");
    els.explainBreakdown = $("explain-breakdown");
    els.explainTaxonomy = $("explain-taxonomy");
    els.explainCompare = $("explain-compare");

    state.prefs = Store.loadModelPrefs();
    if (state.prefs.showConfidence == null) state.prefs.showConfidence = false;
    if (state.prefs.coverageVisible == null) state.prefs.coverageVisible = true;
    if (state.prefs.opacity == null) state.prefs.opacity = DEFAULT_HEAT_OPACITY;
    if (state.prefs.includeObservationsInHabitat == null) state.prefs.includeObservationsInHabitat = false;
    state.searchAreasVisible = !!state.prefs.searchAreasVisible;
    if (Store.migrateIfNeeded) Store.migrateIfNeeded();
    if (Sessions.migrateSessionsIfNeeded) Sessions.migrateSessionsIfNeeded();
    state.heatFilters = Patterns.defaultHeatFilters();
    loadHeatUiPrefs();
    fillTypeSelects();
    if ($("model-preset") && Presets) {
      $("model-preset").innerHTML = Presets.listPresets().map(function (p) {
        return "<option value=\"" + p.id + "\">" + p.label + "</option>";
      }).join("") + "<option value=\"balanced\">Custom (edit weights)</option>";
    }
    if ($("season-override") && Bio) {
      var opts = "<option value=\"auto\">Automatic from date + latitude</option>";
      Object.keys(Bio.SEASON_PHASES).forEach(function (id) {
        opts += "<option value=\"" + id + "\">" + Bio.SEASON_PHASES[id].label + " (manual)</option>";
      });
      $("season-override").innerHTML = opts;
    }
    initMap();
    bindControls();
    syncControlsForm();
    refreshObservations();
    refreshScoutSpots();
    refreshCoverageMarks();
    updateSeasonPill();
    var active = Sessions.getActiveSession();
    if (active) {
      state.activeSessionId = active.id;
      redrawTrack(active);
      var ver = active.modelVersion ? (" · model " + active.modelVersion) : "";
      syncSessionPill("Resume ready · " + Math.round(active.distanceM || 0) + " m" + ver, true);
      if (els.sessionPill) els.sessionPill.dataset.state = "available";
      if (els.btnTrack) setFabLabel(els.btnTrack, "End Search");
      syncSessionStrip();
    } else {
      syncSessionPill("", false);
      syncSessionStrip();
    }
    // Phase 1 location truth: always attempt locate. Sticky denial is reconciled
    // against live Permissions API inside locateUser. Center on initial GPS even
    // when a prior session saved a map view (saved view remains fallback if GPS fails).
    locateUser({ center: true });
    setPlanExpanded(false);
    syncHeatLegend();
    syncSearchAreasLegend();
    if (state.searchAreasVisible) setSearchAreasVisible(true);
    syncSearchPrompt();
    initFirstRunCoach();
    ensureGisPacks().then(function () {
      scheduleRecompute(200);
    });
    $("ethics-ack").addEventListener("click", onEthicsAck);
    maybeEthics();
    syncOfflineBanner();
    window.addEventListener("online", syncOfflineBanner);
    window.addEventListener("offline", syncOfflineBanner);

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.documentElement.classList.add("reduced-motion");
      if (heatLayer && heatLayer.setSmooth) heatLayer.setSmooth(false);
    }
  }

  try {
    window.WaypointShedsMapApp = {
      saveScoutSpotFromInspect: saveScoutSpotFromInspect,
      openScoutSpot: openScoutSpot,
      closeScoutHud: closeScoutHud,
      refreshScoutSpots: refreshScoutSpots,
      openHuntPlan: openHuntPlan,
      closeHuntPlanHud: closeHuntPlanHud,
      startHuntSelect: startHuntSelect,
      inspectAt: showInspectAt
    };
  } catch (eApi) { /* */ }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
