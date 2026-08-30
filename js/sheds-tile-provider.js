/**
 * Sheds basemap tile providers — production-safe defaults.
 *
 * Do not use OSMF public raster tiles (tile.openstreetmap.org): that service
 * is donation-funded, has no SLA, and blocks production web apps by returning
 * HTTP 200 placeholder PNGs with `x-blocked` (gray gaps with no tileerror).
 *
 * Defaults: Esri World Street Map (street) + Esri World Topo + Esri World Imagery
 * (+ Imagery Hybrid = imagery + Esri reference labels).
 * Do not default Street to unauthenticated CARTO Voyager — those tiles paint
 * “API KEY REQUIRED”. Optional override via window.WAYPOINT_MAP_TILE_CONFIG or
 * <meta name="waypoint-map-tiles" content='{"streetUrl":"..."}'>.
 *
 * Licensing note: Esri ArcGIS Online basemap tiles require on-map attribution
 * and must not be systematically harvested for redistribution/offline packs.
 * Sheds already ships Esri World Topo; World Imagery uses the same host family.
 * See docs/sheds/SHEDS-V3-MAPPING-FOUNDATION.md.
 */
(function (global) {
  "use strict";

  var OSM_PUBLIC_HOST_RE = /(^|\.)tile\.openstreetmap\.org$/i;
  var CARTO_CDN_HOST_RE = /(^|\.)cartocdn\.com$/i;
  var BASEMAP_STORAGE_KEY = "waypoint-sheds-basemap-v1";
  var VALID_BASEMAP_IDS = ["street", "topo", "satellite", "hybrid"];

  var DEFAULTS = {
    streetId: "esri-world-street",
    streetLabel: "Street",
    streetUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    streetSubdomains: "",
    streetMaxZoom: 19,
    streetAttribution:
      "Tiles &copy; Esri &mdash; Esri, USGS, NOAA, and the GIS User Community",
    topoId: "esri-world-topo",
    topoLabel: "Topographic",
    topoUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    topoMaxZoom: 19,
    topoAttribution:
      "Tiles &copy; Esri &mdash; Esri, USGS, NOAA, and the GIS User Community",
    satelliteId: "esri-world-imagery",
    satelliteLabel: "Satellite",
    satelliteUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    satelliteMaxZoom: 19,
    satelliteAttribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    /* Reference labels for Hybrid — same Esri family, not a scraped mashup */
    hybridRefId: "esri-world-reference",
    hybridRefUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    hybridRefMaxZoom: 19,
    hybridRefAttribution:
      "Reference &copy; Esri &mdash; Esri, HERE, Garmin, and the GIS User Community",
    hybridId: "esri-imagery-hybrid",
    hybridLabel: "Hybrid"
  };

  function readMetaConfig() {
    try {
      var el = global.document && global.document.querySelector('meta[name="waypoint-map-tiles"]');
      if (!el) return null;
      var raw = el.getAttribute("content");
      if (!raw || raw === "local" || raw.charAt(0) !== "{") return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function mergeConfig() {
    var cfg = Object.assign({}, DEFAULTS);
    var meta = readMetaConfig();
    if (meta && typeof meta === "object") Object.assign(cfg, meta);
    if (global.WAYPOINT_MAP_TILE_CONFIG && typeof global.WAYPOINT_MAP_TILE_CONFIG === "object") {
      Object.assign(cfg, global.WAYPOINT_MAP_TILE_CONFIG);
    }
    return cfg;
  }

  function hostOfTemplate(url) {
    var s = String(url || "")
      .replace(/\{s\}/gi, "a")
      .replace(/\{r\}/gi, "")
      .replace(/\{[zyx]\}/gi, "0");
    var m = s.match(/^https?:\/\/([^/]+)/i);
    return m ? m[1].toLowerCase() : "";
  }

  function assertNotOsmPublic(url, role) {
    var host = hostOfTemplate(url);
    if (OSM_PUBLIC_HOST_RE.test(host)) {
      throw new Error(
        "Sheds refuses OSMF public tiles for " +
          role +
          " (" +
          host +
          "). Use a production tile provider. See docs/sheds/map-reliability-owner-review.md"
      );
    }
  }

  function cartoApiKeyFromUrl(url) {
    var s = String(url || "");
    var m = s.match(/[?&](?:api[_-]?key|apikey)=([^&]*)/i);
    if (!m) return "";
    var v = "";
    try {
      v = decodeURIComponent(m[1] || "").trim();
    } catch (e) {
      v = String(m[1] || "").trim();
    }
    if (!v || v.length < 8) return "";
    if (/^(required|your[_-]?api[_-]?key|placeholder|changeme|api[_-]?key[_-]?required)$/i.test(v)) {
      return "";
    }
    return v;
  }

  function isCartoBasemapHost(url) {
    return CARTO_CDN_HOST_RE.test(hostOfTemplate(url));
  }

  function isUnauthenticatedCartoBasemap(url) {
    return isCartoBasemapHost(url) && !cartoApiKeyFromUrl(url);
  }

  function isPublishableStreetUrl(url) {
    var s = String(url || "");
    if (!/^https:\/\//i.test(s)) return false;
    try {
      assertNotOsmPublic(s, "street");
    } catch (e) {
      return false;
    }
    if (isUnauthenticatedCartoBasemap(s)) return false;
    return true;
  }

  function assertPublishableStreetUrl(url) {
    if (isPublishableStreetUrl(url)) return;
    throw new Error(
      "Sheds refuses unauthenticated CARTO basemap tiles for Street (those PNGs include an API KEY REQUIRED watermark). Use Esri World Street Map or a keyed CARTO URL. Do not invent a key."
    );
  }

  function createLayer(L, opts) {
    opts = opts || {};
    assertNotOsmPublic(opts.url, opts.id || "layer");
    var layerOpts = {
      maxZoom: opts.maxZoom || 19,
      attribution: opts.attribution || "",
      updateWhenIdle: false,
      keepBuffer: opts.keepBuffer != null ? opts.keepBuffer : 3
    };
    if (opts.subdomains) layerOpts.subdomains = opts.subdomains;
    var layer = L.tileLayer(opts.url, layerOpts);
    layer._shedsProviderId = opts.id || "custom";
    layer._shedsProviderLabel = opts.label || opts.id || "Map";
    layer._shedsBasemapId = opts.basemapId || null;
    return layer;
  }

  /**
   * Intelligent tile retry + status callbacks.
   * Leaflet tileerror covers network/decode failures; OSMF blocked PNGs
   * never fire tileerror (HTTP 200) — avoided by refusing that host.
   */
  function attachReliability(layer, hooks) {
    hooks = hooks || {};
    var fails = 0;
    var loads = 0;
    var pendingRetry = new WeakMap();

    function emit() {
      if (typeof hooks.onStatus === "function") {
        hooks.onStatus({
          loads: loads,
          fails: fails,
          providerId: layer._shedsProviderId,
          providerLabel: layer._shedsProviderLabel,
          degraded: fails >= 3 && loads === 0,
          struggling: fails >= 6 && fails > loads
        });
      }
    }

    layer.on("loading", function () {
      if (typeof hooks.onLoading === "function") hooks.onLoading(true);
    });
    layer.on("load", function () {
      if (typeof hooks.onLoading === "function") hooks.onLoading(false);
      emit();
    });
    layer.on("tileload", function () {
      loads += 1;
      if (fails > 0) fails -= 1;
      emit();
    });
    layer.on("tileerror", function (ev) {
      fails += 1;
      emit();
      var tile = ev && ev.tile;
      if (!tile || !tile.src) return;
      var attempt = (pendingRetry.get(tile) || 0) + 1;
      pendingRetry.set(tile, attempt);
      if (attempt > 3) return;
      var src = tile.src.replace(/([?&])shedsRetry=\d+/, "").replace(/\?$/, "");
      var sep = src.indexOf("?") >= 0 ? "&" : "?";
      var next = src + sep + "shedsRetry=" + attempt;
      global.setTimeout(function () {
        try {
          tile.src = next;
        } catch (e) { /* */ }
      }, 280 * attempt);
    });
    return layer;
  }

  function normalizeBasemapId(id) {
    var s = String(id || "").toLowerCase();
    if (VALID_BASEMAP_IDS.indexOf(s) >= 0) return s;
    return null;
  }

  function loadSavedBasemapId() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(BASEMAP_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var id = normalizeBasemapId(parsed && parsed.id);
      return id;
    } catch (e) {
      return null;
    }
  }

  function saveBasemapId(id) {
    var norm = normalizeBasemapId(id);
    if (!norm) return false;
    try {
      if (!global.localStorage) return false;
      global.localStorage.setItem(
        BASEMAP_STORAGE_KEY,
        JSON.stringify({ id: norm, savedAt: new Date().toISOString() })
      );
      return true;
    } catch (e) {
      return false;
    }
  }

  function createBasemaps(L) {
    if (!L || !L.tileLayer) throw new Error("Leaflet required");
    var cfg = mergeConfig();
    assertPublishableStreetUrl(cfg.streetUrl);
    var street = createLayer(L, {
      id: cfg.streetId,
      label: cfg.streetLabel,
      url: cfg.streetUrl,
      subdomains: cfg.streetSubdomains,
      maxZoom: cfg.streetMaxZoom,
      attribution: cfg.streetAttribution,
      keepBuffer: 3,
      basemapId: "street"
    });
    var topo = createLayer(L, {
      id: cfg.topoId,
      label: cfg.topoLabel,
      url: cfg.topoUrl,
      maxZoom: cfg.topoMaxZoom,
      attribution: cfg.topoAttribution,
      keepBuffer: 2,
      basemapId: "topo"
    });
    var satellite = createLayer(L, {
      id: cfg.satelliteId,
      label: cfg.satelliteLabel,
      url: cfg.satelliteUrl,
      maxZoom: cfg.satelliteMaxZoom,
      attribution: cfg.satelliteAttribution,
      keepBuffer: 2,
      basemapId: "satellite"
    });
    var hybridRef = createLayer(L, {
      id: cfg.hybridRefId,
      label: "Reference labels",
      url: cfg.hybridRefUrl,
      maxZoom: cfg.hybridRefMaxZoom,
      attribution: cfg.hybridRefAttribution,
      keepBuffer: 1,
      basemapId: "hybrid"
    });
    /* Imagery + reference labels as one selectable basemap (legal Esri hybrid pattern). */
    var hybridImagery = createLayer(L, {
      id: cfg.satelliteId + "-hybrid-base",
      label: cfg.hybridLabel,
      url: cfg.satelliteUrl,
      maxZoom: cfg.satelliteMaxZoom,
      attribution: cfg.satelliteAttribution,
      keepBuffer: 2,
      basemapId: "hybrid"
    });
    var hybrid =
      L.layerGroup && typeof L.layerGroup === "function"
        ? L.layerGroup([hybridImagery, hybridRef])
        : hybridImagery;
    hybrid._shedsProviderId = cfg.hybridId;
    hybrid._shedsProviderLabel = cfg.hybridLabel;
    hybrid._shedsBasemapId = "hybrid";

    var byId = {
      street: street,
      topo: topo,
      satellite: satellite,
      hybrid: hybrid
    };

    var baseLayers = {};
    baseLayers[cfg.streetLabel] = street;
    baseLayers[cfg.topoLabel] = topo;
    baseLayers[cfg.satelliteLabel] = satellite;
    baseLayers[cfg.hybridLabel] = hybrid;

    return {
      config: cfg,
      street: street,
      topo: topo,
      satellite: satellite,
      hybrid: hybrid,
      hybridRef: hybridRef,
      hybridImagery: hybridImagery,
      byId: byId,
      baseLayers: baseLayers,
      ids: VALID_BASEMAP_IDS.slice()
    };
  }

  function listBasemapOptions(basemaps) {
    var cfg = (basemaps && basemaps.config) || mergeConfig();
    return [
      { id: "street", label: cfg.streetLabel },
      { id: "topo", label: cfg.topoLabel },
      { id: "satellite", label: cfg.satelliteLabel },
      { id: "hybrid", label: cfg.hybridLabel }
    ];
  }

  /**
   * Swap active basemap. Removes other Sheds basemap layers first.
   * Returns the applied id (may fall back to street).
   */
  function applyBasemap(map, basemaps, id, hooks) {
    hooks = hooks || {};
    if (!map || !basemaps || !basemaps.byId) return null;
    var want = normalizeBasemapId(id) || "street";
    if (!basemaps.byId[want]) want = "street";
    var ids = VALID_BASEMAP_IDS;
    var i;
    for (i = 0; i < ids.length; i += 1) {
      var layer = basemaps.byId[ids[i]];
      if (layer && map.hasLayer(layer)) {
        try {
          map.removeLayer(layer);
        } catch (e) { /* */ }
      }
    }
    /* Guard against orphaned Hybrid children if a prior path added them bare. */
    ["hybridRef", "hybridImagery"].forEach(function (key) {
      var orphan = basemaps[key];
      if (orphan && map.hasLayer(orphan)) {
        try {
          map.removeLayer(orphan);
        } catch (e2) { /* */ }
      }
    });
    var next = basemaps.byId[want];
    if (!next) return null;
    next.addTo(map);
    saveBasemapId(want);
    if (typeof hooks.onApplied === "function") hooks.onApplied(want, next);
    return want;
  }

  function resolveInitialBasemapId(basemaps) {
    var saved = loadSavedBasemapId();
    if (saved && basemaps && basemaps.byId && basemaps.byId[saved]) return saved;
    return "street";
  }

  global.WaypointShedsTiles = {
    DEFAULTS: DEFAULTS,
    BASEMAP_STORAGE_KEY: BASEMAP_STORAGE_KEY,
    VALID_BASEMAP_IDS: VALID_BASEMAP_IDS.slice(),
    mergeConfig: mergeConfig,
    createBasemaps: createBasemaps,
    attachReliability: attachReliability,
    assertNotOsmPublic: assertNotOsmPublic,
    cartoApiKeyFromUrl: cartoApiKeyFromUrl,
    isCartoBasemapHost: isCartoBasemapHost,
    isUnauthenticatedCartoBasemap: isUnauthenticatedCartoBasemap,
    isPublishableStreetUrl: isPublishableStreetUrl,
    assertPublishableStreetUrl: assertPublishableStreetUrl,
    normalizeBasemapId: normalizeBasemapId,
    loadSavedBasemapId: loadSavedBasemapId,
    saveBasemapId: saveBasemapId,
    listBasemapOptions: listBasemapOptions,
    applyBasemap: applyBasemap,
    resolveInitialBasemapId: resolveInitialBasemapId,
    isOsmPublicHost: function (host) {
      return OSM_PUBLIC_HOST_RE.test(String(host || ""));
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
