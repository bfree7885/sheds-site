/**
 * Sheds — domain data foundations (local-first).
 * No cloud sync. No public find coordinates by default.
 */
(function (global) {
  "use strict";

  var FINDS_KEY = "waypoint-sheds-finds-v1";
  var SPECIES = [
    { id: "odocoileus-virginianus", commonName: "White-tailed Deer", scientificName: "Odocoileus virginianus" },
    { id: "odocoileus-hemionus", commonName: "Mule Deer", scientificName: "Odocoileus hemionus" },
    { id: "cervus-canadensis", commonName: "Elk", scientificName: "Cervus canadensis" },
    { id: "alces-alces", commonName: "Moose", scientificName: "Alces alces" },
    { id: "rangifer-tarandus", commonName: "Caribou", scientificName: "Rangifer tarandus" },
    { id: "cervus-elaphus", commonName: "Red Deer", scientificName: "Cervus elaphus" },
    { id: "dama-dama", commonName: "Fallow Deer", scientificName: "Dama dama" },
    { id: "capreolus-capreolus", commonName: "Roe Deer", scientificName: "Capreolus capreolus" },
    { id: "cervus-nippon", commonName: "Sika Deer", scientificName: "Cervus nippon" }
  ];

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function createFind(partial) {
    partial = partial || {};
    return {
      schemaVersion: "1.0.0",
      id: "shed_" + uuid(),
      speciesId: partial.speciesId || null,
      observedAt: partial.observedAt || new Date().toISOString(),
      notes: partial.notes || null,
      media: partial.media || [],
      location: {
        lat: null,
        lng: null,
        precision: "hidden",
        privacy: "private"
      },
      privacy: "private",
      observationId: partial.observationId || null,
      createdAt: new Date().toISOString()
    };
  }

  function listFinds() {
    try {
      var raw = localStorage.getItem(FINDS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveFind(find) {
    var all = listFinds().filter(function (f) { return f.id !== find.id; });
    all.unshift(find);
    try {
      localStorage.setItem(FINDS_KEY, JSON.stringify(all.slice(0, 200)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function importFinds(records) {
    var incoming = Array.isArray(records) ? records : [];
    var byId = {};
    listFinds().forEach(function (f) {
      if (f && f.id) byId[f.id] = f;
    });
    var added = 0;
    var replaced = 0;
    incoming.forEach(function (raw) {
      if (!raw || !raw.id) return;
      if (byId[raw.id]) replaced += 1;
      else added += 1;
      byId[raw.id] = raw;
    });
    var merged = [];
    Object.keys(byId).forEach(function (id) { merged.push(byId[id]); });
    try {
      localStorage.setItem(FINDS_KEY, JSON.stringify(merged.slice(0, 200)));
      return { ok: true, added: added, replaced: replaced, total: merged.length };
    } catch (e) {
      return { ok: false, error: "Could not save imported finds.", added: 0, replaced: 0, total: listFinds().length };
    }
  }

  global.WaypointSheds = {
    SPECIES: SPECIES,
    FINDS_KEY: FINDS_KEY,
    createFind: createFind,
    listFinds: listFinds,
    saveFind: saveFind,
    importFinds: importFinds
  };
})(window);
