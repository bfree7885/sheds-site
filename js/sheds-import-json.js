/**
 * Shed Hunting — import a sheds-field-private.json export.
 * Merge-by-id into this origin’s localStorage. No cross-origin copy.
 */
(function (global) {
  "use strict";

  function unwrap(section, key) {
    if (!section) return [];
    if (Array.isArray(section)) return section;
    if (key && Array.isArray(section[key])) return section[key];
    return [];
  }

  function parseExport(raw) {
    var obj = raw;
    if (typeof raw === "string") {
      try {
        obj = JSON.parse(raw);
      } catch (e) {
        return { ok: false, error: "That file is not valid JSON." };
      }
    }
    if (!obj || typeof obj !== "object") {
      return { ok: false, error: "That file is not a Shed Hunting export." };
    }
    var observations = unwrap(obj.observations, "observations");
    var sessions = unwrap(obj.sessions, "sessions");
    var coverage = unwrap(obj.sessions, "coverage");
    if (Array.isArray(obj.coverage)) coverage = obj.coverage;
    var searchAreas = unwrap(obj.searchAreas, "searchAreas");
    var scoutSpots = unwrap(obj.scoutSpots, "scoutSpots");
    var huntPlans = unwrap(obj.huntPlans, "huntPlans");
    var validations = unwrap(obj.validations, "validations");
    if (!validations.length && Array.isArray(obj.validations)) validations = obj.validations;
    var finds = unwrap(obj.finds, "finds");
    var huntRecords = unwrap(obj.huntRecords, "huntRecords");
    var hasBody =
      observations.length ||
      sessions.length ||
      coverage.length ||
      searchAreas.length ||
      scoutSpots.length ||
      huntPlans.length ||
      huntRecords.length ||
      validations.length ||
      finds.length ||
      (obj.modelPrefs && typeof obj.modelPrefs === "object");
    if (!hasBody) {
      return { ok: false, error: "That JSON does not look like a Shed Hunting field export." };
    }
    return {
      ok: true,
      observations: observations,
      sessions: sessions,
      coverage: coverage,
      searchAreas: searchAreas,
      scoutSpots: scoutSpots,
      huntPlans: huntPlans,
      huntRecords: huntRecords,
      validations: validations,
      finds: finds,
      modelPrefs: obj.modelPrefs && typeof obj.modelPrefs === "object" ? obj.modelPrefs : null
    };
  }

  function importPayload(parsed) {
    if (!parsed || !parsed.ok) return parsed || { ok: false, error: "Nothing to import." };
    var counts = {};
    var Store = global.WaypointShedsObservations;
    var Sessions = global.WaypointShedsSessions;
    var AreaStore = global.WaypointShedsSearchAreaStore;
    var ScoutStore = global.WaypointShedsScoutSpots;
    var HuntPlans = global.WaypointShedsHuntPlans;
    var HuntRecords = global.WaypointShedsHuntRecords;
    var Validation = global.WaypointShedsValidation;
    var Finds = global.WaypointSheds;

    if (Store && Store.importList) {
      counts.observations = Store.importList(parsed.observations);
    }
    if (Sessions && Sessions.importBundle) {
      counts.sessions = Sessions.importBundle({
        sessions: parsed.sessions,
        coverage: parsed.coverage
      });
    }
    if (AreaStore && AreaStore.importList) {
      counts.searchAreas = AreaStore.importList(parsed.searchAreas);
    }
    if (ScoutStore && ScoutStore.importList) {
      counts.scoutSpots = ScoutStore.importList(parsed.scoutSpots);
    }
    if (HuntPlans && HuntPlans.importList) {
      counts.huntPlans = HuntPlans.importList(parsed.huntPlans);
    }
    if (HuntRecords && HuntRecords.importList) {
      counts.huntRecords = HuntRecords.importList(parsed.huntRecords);
    }
    if (Validation && Validation.importList) {
      counts.validations = Validation.importList(parsed.validations);
    }
    if (Finds && Finds.importFinds) {
      counts.finds = Finds.importFinds(parsed.finds);
    }
    if (parsed.modelPrefs && Store && Store.saveModelPrefs) {
      Store.saveModelPrefs(parsed.modelPrefs);
      counts.modelPrefs = { ok: true };
    }
    var failed = Object.keys(counts).filter(function (k) {
      return counts[k] && counts[k].ok === false;
    });
    if (failed.length) {
      return { ok: false, error: "Some records could not be saved (" + failed.join(", ") + ").", counts: counts };
    }
    return { ok: true, counts: counts };
  }

  global.WaypointShedsImport = {
    parseExport: parseExport,
    importPayload: importPayload
  };
})(typeof window !== "undefined" ? window : globalThis);
