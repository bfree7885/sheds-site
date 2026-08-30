/**
 * ShedHunting.org overview — boot Today's Hunt on the dedicated host.
 * Location: GPS if granted → last map view → last Search Area → ask.
 * Never invents a city. Does not block the rest of the page.
 */
(function (global) {
  "use strict";

  var Hunt = global.WaypointShedsTodayHunt;
  var Wx = global.WaypointShedsWeather;
  var Store = global.WaypointShedsObservations;
  var Areas = global.WaypointShedsSearchAreaStore;

  var root = document.getElementById("todays-hunt");
  var prompt = document.getElementById("hunt-location-prompt");
  var useBtn = document.getElementById("hunt-use-location");
  var statusEl = document.getElementById("hunt-status");

  if (!root || !Hunt) return;

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.hidden = !text;
  }

  function showPrompt(show) {
    if (!prompt) return;
    prompt.hidden = !show;
  }

  function savedLocation() {
    if (Store && typeof Store.loadMapView === "function") {
      var view = Store.loadMapView();
      if (view && isFinite(view.lat) && isFinite(view.lng)) {
        return { lat: view.lat, lng: view.lng, source: "saved-view" };
      }
    }
    if (Areas && typeof Areas.list === "function") {
      var list = Areas.list();
      if (list && list[0] && list[0].center) {
        return {
          lat: list[0].center.lat,
          lng: list[0].center.lng,
          source: "saved-area"
        };
      }
    }
    return null;
  }

  function render(hunt) {
    Hunt.fillHuntRoot(root, hunt, { includeQuestion: false });
    setStatus("");
    showPrompt(!!(hunt && hunt.status === "need_location"));
  }

  function composeAt(loc, weather, weatherStatus) {
    return Hunt.compose({
      now: new Date(),
      location: loc,
      weather: weather,
      weatherStatus: weatherStatus || (weather ? "ready" : "unavailable")
    });
  }

  function fetchWeather(loc) {
    if (!Wx || typeof Wx.fetchForecast !== "function") {
      return Promise.resolve(null);
    }
    return Wx.fetchForecast(loc.lat, loc.lng).then(function (pkg) {
      return pkg && pkg.ready ? pkg : null;
    }).catch(function () {
      return null;
    });
  }

  function runWithLocation(loc) {
    setStatus("");
    showPrompt(false);
    render(composeAt(loc, null, "loading"));
    return fetchWeather(loc).then(function (pkg) {
      var hunt = composeAt(loc, pkg, pkg ? "ready" : "unavailable");
      render(hunt);
      setStatus("");
      return hunt;
    });
  }

  function runWithoutLocation() {
    var hunt = composeAt(null, null, "unavailable");
    render(hunt);
    setStatus("");
    showPrompt(true);
  }

  function geoSupported() {
    return typeof navigator !== "undefined" && navigator.geolocation &&
      typeof navigator.geolocation.getCurrentPosition === "function";
  }

  function requestGeo() {
    if (!geoSupported()) {
      runWithoutLocation();
      return;
    }
    setStatus("Asking for location…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      var loc = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        source: "gps"
      };
      if (Store && typeof Store.saveMapView === "function") {
        Store.saveMapView({ lat: loc.lat, lng: loc.lng, zoom: 12 });
      }
      runWithLocation(loc);
    }, function () {
      var saved = savedLocation();
      if (saved) runWithLocation(saved);
      else runWithoutLocation();
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }

  function start() {
    render(composeAt(null, null, "loading"));

    var saved = savedLocation();

    function afterPermission(state) {
      if (state === "granted") {
        requestGeo();
        return;
      }
      if (saved) {
        runWithLocation(saved);
        return;
      }
      runWithoutLocation();
    }

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "geolocation" }).then(function (p) {
        afterPermission(p.state);
      }).catch(function () {
        if (saved) runWithLocation(saved);
        else runWithoutLocation();
      });
      return;
    }

    if (saved) runWithLocation(saved);
    else runWithoutLocation();
  }

  if (useBtn) {
    useBtn.addEventListener("click", function () {
      requestGeo();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(typeof window !== "undefined" ? window : globalThis);
