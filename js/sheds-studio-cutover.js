/**
 * Studio → ShedHunting.org cutover (Phase 3C).
 *
 * GitHub Pages cannot emit HTTP 301/308. Production Studio hosts use
 * location.replace (+ alias pages also use meta refresh). This helper must
 * not run on shedhunting.org, on data-shed-host documents, or on loopback
 * (local map/overview development and CI smoke).
 */
(function (global) {
  "use strict";

  var OVERVIEW = "https://shedhunting.org/";
  var MAP = "https://shedhunting.org/map/";
  var SHED_HOSTS = {
    "shedhunting.org": 1,
    "www.shedhunting.org": 1
  };
  var LOOPBACK = {
    localhost: 1,
    "127.0.0.1": 1,
    "[::1]": 1,
    "::1": 1
  };

  function hostname() {
    try {
      return String((global.location && global.location.hostname) || "").toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function hasLocalFlag() {
    try {
      return /(?:^|[?&])local=1(?:&|$)/.test(String((global.location && location.search) || ""));
    } catch (e) {
      return false;
    }
  }

  function hrefWithLocal(href) {
    var next = String(href || "");
    var hash = "";
    var hashAt = next.indexOf("#");
    if (hashAt >= 0) {
      hash = next.slice(hashAt);
      next = next.slice(0, hashAt);
    }
    if (/(?:^|[?&])local=1(?:&|$)/.test(next)) return next + hash;
    next += next.indexOf("?") >= 0 ? "&local=1" : "?local=1";
    return next + hash;
  }

  function isHatchNavHref(href) {
    var path = String(href || "").split("#")[0].split("?")[0];
    return (
      path === "map/" ||
      path === "map" ||
      path === "./map/" ||
      path === "./map" ||
      path === "../" ||
      path === ".." ||
      path === "./" ||
      path === "."
    );
  }

  function preserveLocalNav(root) {
    if (!hasLocalFlag()) return;
    try {
      var doc = root || (global.document && global.document);
      if (!doc || !doc.querySelectorAll) return;
      var nodes = doc.querySelectorAll("a[href]");
      for (var i = 0; i < nodes.length; i++) {
        var href = nodes[i].getAttribute("href") || "";
        if (!isHatchNavHref(href)) continue;
        nodes[i].setAttribute("href", hrefWithLocal(href));
      }
    } catch (e) {}
  }

  function schedulePreserveLocalNav() {
    try {
      var doc = global.document;
      if (!doc || !doc.querySelectorAll) return;
      if (doc.readyState === "loading" && doc.addEventListener) {
        doc.addEventListener("DOMContentLoaded", function () {
          preserveLocalNav();
        });
      } else {
        preserveLocalNav();
      }
    } catch (e) {}
  }

  function isShedHostDocument() {
    try {
      var el = global.document && global.document.documentElement;
      return !!(el && el.getAttribute("data-shed-host") === "1");
    } catch (e) {
      return false;
    }
  }

  function shouldStay(opts) {
    opts = opts || {};
    if (isShedHostDocument()) return true;
    var host = hostname();
    if (SHED_HOSTS[host]) return true;
    if (hasLocalFlag()) return true;
    if (!opts.forcePublic && LOOPBACK[host]) return true;
    return false;
  }

  function destinationWithLocation(dest) {
    var next = String(dest || "");
    try {
      if (global.location && location.search) next += location.search;
      if (global.location && location.hash) next += location.hash;
    } catch (e) {}
    return next;
  }

  function redirectLegacyStudio(dest, opts) {
    if (shouldStay(opts)) return false;
    var next = destinationWithLocation(dest);
    try {
      global.location.replace(next);
    } catch (e) {}
    return true;
  }

  function showFallback(el) {
    if (!el) return;
    try {
      el.hidden = false;
      el.removeAttribute("hidden");
    } catch (e) {}
  }

  schedulePreserveLocalNav();

  global.WaypointShedsCutover = {
    OVERVIEW: OVERVIEW,
    MAP: MAP,
    shouldStay: shouldStay,
    redirectLegacyStudio: redirectLegacyStudio,
    destinationWithLocation: destinationWithLocation,
    hrefWithLocal: hrefWithLocal,
    preserveLocalNav: preserveLocalNav,
    showFallback: showFallback
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
