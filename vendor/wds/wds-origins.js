/**
 * Waypoint Studio / Shed Hunting origin helpers.
 * Source of truth: design-system/ecosystem/origin-config.json (keep in sync).
 *
 * Phase 3C: shedDedicatedHostEnabled is true. Public Shed Hunting hrefs use
 * https://shedhunting.org. Studio remains https://waypointstudio.org.
 */
(function (global) {
  "use strict";

  var ORIGIN_CONFIG = {
    version: "1.0.0",
    studioOrigin: "https://waypointstudio.org",
    shedOrigin: "https://shedhunting.org",
    shedDedicatedHostEnabled: true,
    shedHostnames: ["shedhunting.org", "www.shedhunting.org"],
    studioPaths: {
      home: "/",
      dashboard: "/apps/dashboard/",
      shedHunting: "/apps/shed-hunting/",
      shedHuntingMap: "/apps/shed-hunting/map/",
      shedsAlias: "/sheds/",
      mapAlias: "/map/",
      articles: "/articles/",
      support: "/support.html",
      about: "/about.html",
      privacy: "/privacy.html",
      terms: "/terms.html",
      contact: "/contact.html",
      knowledge: "/knowledge.html"
    },
    shedHostPaths: {
      home: "/",
      map: "/map/"
    }
  };

  function trimSlash(url) {
    return String(url || "").replace(/\/+$/, "");
  }

  function config() {
    var override = global.WDS && global.WDS.ORIGIN_CONFIG;
    if (override && typeof override === "object") {
      return override;
    }
    var navOrigins = global.WDS && global.WDS.APP_NAV_CONFIG && global.WDS.APP_NAV_CONFIG.origins;
    if (navOrigins && typeof navOrigins === "object") {
      var merged = {};
      var key;
      for (key in ORIGIN_CONFIG) {
        if (Object.prototype.hasOwnProperty.call(ORIGIN_CONFIG, key)) merged[key] = ORIGIN_CONFIG[key];
      }
      for (key in navOrigins) {
        if (Object.prototype.hasOwnProperty.call(navOrigins, key)) merged[key] = navOrigins[key];
      }
      return merged;
    }
    return ORIGIN_CONFIG;
  }

  function originHost(origin) {
    try {
      return new URL(origin).hostname;
    } catch (e) {
      return "";
    }
  }

  function currentHostname() {
    try {
      return String((global.location && global.location.hostname) || "");
    } catch (e) {
      return "";
    }
  }

  function hasShedHostAttr() {
    try {
      return !!(global.document && document.documentElement &&
        document.documentElement.getAttribute("data-shed-host") === "1");
    } catch (e) {
      return false;
    }
  }

  function isShedHost() {
    var cfg = config();
    if (hasShedHostAttr()) return true;
    var host = currentHostname();
    if (!host) return false;
    var names = cfg.shedHostnames || [];
    for (var i = 0; i < names.length; i += 1) {
      if (names[i] === host) return true;
    }
    return host === originHost(cfg.shedOrigin);
  }

  function shedDedicatedHostEnabled() {
    return !!config().shedDedicatedHostEnabled;
  }

  function studioOrigin() {
    return trimSlash(config().studioOrigin || "https://waypointstudio.org");
  }

  function shedOrigin() {
    return trimSlash(config().shedOrigin || "https://shedhunting.org");
  }

  function studioHref(path) {
    var p = String(path || "/");
    if (!p || p.charAt(0) === "#") return p;
    if (/^https?:\/\//i.test(p)) return p;
    if (p.charAt(0) !== "/") p = "/" + p;
    if (isShedHost()) return studioOrigin() + p;
    return p;
  }

  function poweredByWaypointHref() {
    if (isShedHost()) return studioOrigin() + "/";
    return "/";
  }

  function shedHuntingPublicHref() {
    var cfg = config();
    if (shedDedicatedHostEnabled()) return shedOrigin() + "/";
    return (cfg.studioPaths && cfg.studioPaths.shedHunting) || "/apps/shed-hunting/";
  }

  function shedHuntingMapHref() {
    var cfg = config();
    if (shedDedicatedHostEnabled()) return shedOrigin() + "/map/";
    return (cfg.studioPaths && cfg.studioPaths.shedHuntingMap) || "/apps/shed-hunting/map/";
  }

  function applyDocumentLinks(root) {
    root = root || (global.document || null);
    if (!root || !root.querySelectorAll) return;
    var studio = root.querySelectorAll("[data-studio-path]");
    for (var i = 0; i < studio.length; i += 1) {
      var path = studio[i].getAttribute("data-studio-path");
      if (path) studio[i].setAttribute("href", studioHref(path));
    }
    var powered = root.querySelectorAll("[data-powered-by-waypoint]");
    for (var j = 0; j < powered.length; j += 1) {
      powered[j].setAttribute("href", poweredByWaypointHref());
    }
  }

  function boot() {
    try {
      if (global.document && global.document.readyState === "loading") {
        global.document.addEventListener("DOMContentLoaded", function () {
          applyDocumentLinks();
        });
      } else {
        applyDocumentLinks();
      }
    } catch (e) { /* non-DOM */ }
  }

  global.WDS = global.WDS || {};
  global.WDS.ORIGIN_DEFAULTS = ORIGIN_CONFIG;
  global.WDS.origins = {
    config: config,
    isShedHost: isShedHost,
    shedDedicatedHostEnabled: shedDedicatedHostEnabled,
    studioOrigin: studioOrigin,
    shedOrigin: shedOrigin,
    studioHref: studioHref,
    poweredByWaypointHref: poweredByWaypointHref,
    shedHuntingPublicHref: shedHuntingPublicHref,
    shedHuntingMapHref: shedHuntingMapHref,
    applyDocumentLinks: applyDocumentLinks
  };

  boot();
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
