/**
 * Sheds Phase 3 — map integration helpers (Search Areas, Field Plan, session summary).
 * Loaded after core stores; used by sheds-map-app.js.
 */
(function (global) {
  "use strict";

  function escapeText(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDuration(ms) {
    ms = Math.max(0, ms || 0);
    var sec = Math.round(ms / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    if (m >= 60) {
      var h = Math.floor(m / 60);
      m = m % 60;
      return h + "h " + m + "m";
    }
    return m + "m " + s + "s";
  }

  function renderAreasList(el, areas, handlers) {
    handlers = handlers || {};
    if (!el) return;
    if (!areas || !areas.length) {
      el.innerHTML = "<li><p class=\"sheds-note\">No saved Search Areas yet. Set SEARCH, then Save Search Area.</p></li>";
      return;
    }
    el.innerHTML = areas.map(function (a) {
      var gis = a.gisStatus === "available" ? "Habitat pack available"
        : a.gisStatus === "unavailable" ? "Habitat data unavailable"
          : "Habitat pack unknown";
      return (
        "<li data-area-id=\"" + escapeText(a.id) + "\">" +
        "<p class=\"sheds-area-list__name\">" + escapeText(a.name) + "</p>" +
        "<p class=\"sheds-area-list__meta\">~" + Math.round(a.radiusM || 0) + " m · " + escapeText(gis) +
        (a.status === "archived" ? " · archived" : "") + "</p>" +
        "<div class=\"sheds-area-list__actions\">" +
        "<button type=\"button\" class=\"sheds-btn sheds-btn--compact\" data-area-act=\"open\">Open</button>" +
        "<button type=\"button\" class=\"sheds-btn sheds-btn--compact\" data-area-act=\"rename\">Rename</button>" +
        (a.status === "archived"
          ? "<button type=\"button\" class=\"sheds-btn sheds-btn--compact\" data-area-act=\"unarchive\">Unarchive</button>"
          : "<button type=\"button\" class=\"sheds-btn sheds-btn--compact\" data-area-act=\"archive\">Archive</button>") +
        "<button type=\"button\" class=\"sheds-btn sheds-btn--compact\" data-area-act=\"delete\">Delete</button>" +
        "</div></li>"
      );
    }).join("");
    el.onclick = function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-area-act]") : null;
      if (!btn) return;
      var li = btn.closest("[data-area-id]");
      if (!li) return;
      var id = li.getAttribute("data-area-id");
      var act = btn.getAttribute("data-area-act");
      if (handlers[act]) handlers[act](id);
    };
  }

  function renderFieldPlan(el, plan) {
    if (!el || !plan) return;
    var Ux = global.WaypointShedsUxPolish;
    var area = plan.area;
    var html = "";
    html += "<h3>Search Area</h3>";
    if (area) {
      html += "<p><strong>" + escapeText(area.name) + "</strong> · ~" + Math.round(area.radiusM || 0) + " m</p>";
      html += "<p class=\"sheds-field-plan__gis\">Landscape pack: " + escapeText(area.gisStatus || "unknown") +
        (area.gisPackId ? " (" + escapeText(area.gisPackId) + ")" : "") + "</p>";
    } else {
      html += "<p>" + escapeText((Ux && Ux.EMPTY.NO_SEARCH) || "Tap the map to choose an area to inspect.") + "</p>";
    }
    html += "<h3>When</h3><p>" + escapeText(
      (plan.timing && (plan.timing.plainLabel || plan.timing.label || plan.timing.headline)) || "—"
    ) + "</p>";
    html += "<h3>Landscape <span class=\"sheds-guidance-pill\">MODEL</span></h3>";
    html += "<p>" + escapeText((plan.habitatModel && plan.habitatModel.label) ||
      ((Ux && Ux.EMPTY.NO_GIS) || "Landscape guidance isn’t available for this area yet.")) + "</p>";
    if (plan.includeObservationsInHabitat) {
      html += "<p><span class=\"sheds-guidance-pill sheds-guidance-pill--combined\">COMBINED</span> Observations included in guidance (capped).</p>";
    } else {
      html += "<p><span class=\"sheds-guidance-pill\">MODEL</span> Observations excluded from landscape score.</p>";
    }
    html += "<h3>Today’s conditions</h3><p>" + escapeText((plan.searchability && (plan.searchability.headline || plan.searchability.label)) || "—") + "</p>";
    html += "<h3>Evidence support</h3><p>" + escapeText((plan.evidenceSupport && (plan.evidenceSupport.level || plan.evidenceSupport.label)) || "—") +
      " — evidence support, not find %</p>";
    html += "<h3>My observations</h3><p>" + escapeText(plan.observed && plan.observed.summary) + "</p>";
    html += "<h3>Areas to inspect</h3>";
    if (plan.areasToInspect && plan.areasToInspect.ok && plan.areasToInspect.suggestion) {
      var sug = plan.areasToInspect.suggestion;
      html += "<p>" + escapeText(sug.summary || sug.label || "Suggested inspect point inside Search Area") + "</p>";
      html += "<p class=\"sheds-note\">" + escapeText(plan.areasToInspect.disclaimer) + "</p>";
    } else {
      html += "<p class=\"sheds-note\">" + escapeText((plan.areasToInspect && plan.areasToInspect.disclaimer) || "—") + "</p>";
    }
    html += "<h3>Your notes</h3><p>" + escapeText(plan.userNotes || "—") + "</p>";
    if (plan.degradations && plan.degradations.length) {
      html += "<h3>Offline / limits</h3><p>" + escapeText(plan.degradations.join(" ")) + "</p>";
    }
    html += "<p class=\"sheds-note\">" + escapeText(plan.disclaimer) + "</p>";
    el.innerHTML = html;
  }

  function renderSessionSummary(el, summary) {
    if (!el || !summary) return;
    var dist = summary.distanceAvailable
      ? Math.round(summary.distanceM || 0) + " m"
      : "unavailable (no usable GPS track)";
    el.innerHTML =
      "<p><strong>Search Area:</strong> " + escapeText(summary.searchAreaName || "Current SEARCH / none") + "</p>" +
      "<p><strong>Duration:</strong> " + escapeText(formatDuration(summary.durationMs)) + "</p>" +
      "<p><strong>Distance:</strong> " + escapeText(dist) + "</p>" +
      "<p><strong>Observations:</strong> " + summary.observationCount + "</p>" +
      "<p><strong>Sheds logged:</strong> " + summary.shedsFound + "</p>" +
      (summary.notes ? "<p><strong>Notes:</strong> " + escapeText(summary.notes) + "</p>" : "") +
      "<p class=\"sheds-note\">" + escapeText(summary.disclaimer) + "</p>";
  }

  global.WaypointShedsFieldUi = {
    escapeText: escapeText,
    formatDuration: formatDuration,
    renderAreasList: renderAreasList,
    renderFieldPlan: renderFieldPlan,
    renderSessionSummary: renderSessionSummary
  };
})(typeof window !== "undefined" ? window : globalThis);
