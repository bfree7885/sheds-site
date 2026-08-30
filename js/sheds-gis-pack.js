/**
 * Sheds Phase 2 — GIS pack loader / sampler.
 * Packs are compact JSON (NLCD + edgeM + slopeDeg) for PA AOIs.
 */
(function (global) {
  "use strict";

  var CACHE_PREFIX = "waypoint-sheds-gis-pack-v1:";
  var MANIFEST_KEY = "waypoint-sheds-gis-manifest-v1";

  /** NLCD → structural bucket for UI / scoring */
  var STRUCTURE = {
    11: "water",
    21: "developed",
    22: "developed",
    23: "developed",
    24: "developed",
    31: "other",
    41: "forest",
    42: "forest",
    43: "forest",
    52: "open",
    71: "open",
    81: "agriculture",
    82: "agriculture",
    90: "wetland",
    95: "wetland"
  };

  var STRUCTURE_LABEL = {
    forest: "Forest cover",
    agriculture: "Agriculture",
    open: "Open / shrub / grass",
    developed: "Developed",
    wetland: "Wetland",
    water: "Water",
    other: "Other / barren",
    unknown: "Unknown class"
  };

  function decodeU8(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function inflate(pack) {
    if (pack._inflated) return pack;
    pack.nlcdArr = decodeU8(pack.nlcd);
    pack.edgeArr = decodeU8(pack.edgeM);
    pack.slopeArr = decodeU8(pack.slopeDeg);
    pack._inflated = true;
    return pack;
  }

  function inBounds(pack, lat, lng) {
    var b = pack.bounds;
    return lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north;
  }

  function sample(pack, lat, lng) {
    inflate(pack);
    if (!inBounds(pack, lat, lng)) return null;
    var b = pack.bounds;
    var col = Math.floor(((lng - b.west) / (b.east - b.west)) * pack.cols);
    var row = Math.floor(((b.north - lat) / (b.north - b.south)) * pack.rows);
    col = Math.max(0, Math.min(pack.cols - 1, col));
    row = Math.max(0, Math.min(pack.rows - 1, row));
    var i = row * pack.cols + col;
    var code = pack.nlcdArr[i] || 0;
    var structure = STRUCTURE[code] || "unknown";
    return {
      row: row,
      col: col,
      nlcd: code,
      structure: structure,
      structureLabel: STRUCTURE_LABEL[structure] || STRUCTURE_LABEL.unknown,
      edgeM: pack.edgeArr[i],
      slopeDeg: pack.slopeArr[i],
      cellSizeMApprox: pack.cellSizeMApprox,
      packId: pack.packId,
      resolutionNote: "~" + (pack.sources && pack.sources.nlcd && pack.sources.nlcd.nominalResolutionM
        ? pack.sources.nlcd.nominalResolutionM
        : 30) + " m land-cover source"
    };
  }

  function listBundled() {
    return [
      {
        packId: "pa-pike-milford-v1",
        url: "../gis/packs/pa-pike-milford-v1.json",
        region: "Pike County / Milford-area Pennsylvania"
      }
    ];
  }

  function cacheGet(packId) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + packId);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function cacheSet(pack) {
    try {
      var slim = {
        packId: pack.packId,
        version: pack.version,
        region: pack.region,
        bounds: pack.bounds,
        rows: pack.rows,
        cols: pack.cols,
        cellSizeMApprox: pack.cellSizeMApprox,
        crs: pack.crs,
        sources: pack.sources,
        encoding: pack.encoding,
        sha256: pack.sha256,
        nlcd: pack.nlcd,
        edgeM: pack.edgeM,
        slopeDeg: pack.slopeDeg,
        cachedAt: new Date().toISOString()
      };
      localStorage.setItem(CACHE_PREFIX + pack.packId, JSON.stringify(slim));
      var man = {};
      try {
        man = JSON.parse(localStorage.getItem(MANIFEST_KEY) || "{}") || {};
      } catch (e2) {
        man = {};
      }
      man[pack.packId] = { version: pack.version, sha256: pack.sha256, cachedAt: slim.cachedAt };
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(man));
    } catch (e) {
      /* quota — runtime still holds pack in memory */
    }
  }

  /**
   * Load pack with version/sha invalidation.
   * Online: fetch and replace cache when version or sha256 changes.
   * Offline / fetch fail: use cached pack if present.
   */
  function loadPack(entry, opts) {
    opts = opts || {};
    var cached = cacheGet(entry.packId);
    if (opts.preferCacheOnly && cached && cached.version) {
      return Promise.resolve(inflate(cached));
    }
    return fetch(entry.url, { cache: opts.bustCache ? "no-store" : "default" })
      .then(function (r) {
        if (!r.ok) throw new Error("pack " + r.status);
        return r.json();
      })
      .then(function (pack) {
        var same =
          cached &&
          cached.version === pack.version &&
          (!pack.sha256 || !cached.sha256 || cached.sha256 === pack.sha256);
        if (!same) cacheSet(pack);
        else if (!cached) cacheSet(pack);
        return inflate(same && cached ? cached : pack);
      })
      .catch(function (err) {
        if (cached && cached.version) return inflate(cached);
        throw err;
      });
  }

  function invalidateCache(packId) {
    try {
      if (packId) localStorage.removeItem(CACHE_PREFIX + packId);
      else {
        var man = JSON.parse(localStorage.getItem(MANIFEST_KEY) || "{}") || {};
        Object.keys(man).forEach(function (id) {
          localStorage.removeItem(CACHE_PREFIX + id);
        });
        localStorage.removeItem(MANIFEST_KEY);
      }
    } catch (e) { /* */ }
  }

  function findCoveringPack(packs, lat, lng) {
    if (!packs || !packs.length) return null;
    for (var i = 0; i < packs.length; i++) {
      if (inBounds(packs[i], lat, lng)) return packs[i];
    }
    return null;
  }

  global.WaypointShedsGisPack = {
    STRUCTURE: STRUCTURE,
    STRUCTURE_LABEL: STRUCTURE_LABEL,
    listBundled: listBundled,
    loadPack: loadPack,
    sample: sample,
    inBounds: inBounds,
    findCoveringPack: findCoveringPack,
    cacheGet: cacheGet,
    cacheSet: cacheSet,
    invalidateCache: invalidateCache,
    CACHE_PREFIX: CACHE_PREFIX,
    MANIFEST_KEY: MANIFEST_KEY
  };
})(typeof window !== "undefined" ? window : globalThis);
