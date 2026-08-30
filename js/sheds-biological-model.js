/**
 * Sheds — Whitetail Biological Model v2.0 (Phase 1 prediction truth)
 *
 * Authoritative transparent scorer. NOT machine learning.
 * NOT a probability of finding an antler.
 * Phase 1: spatial habitat interest excludes season/weather wash.
 *
 * See docs/BIOLOGICAL_MODEL.md and docs/sheds/SHEDS-2-PHASE-1-PREDICTION-TRUTH.md
 */
(function (global) {
  "use strict";

  var MODEL_VERSION = "2.0.0";
  var FACTOR_CONFIG_VERSION = "2.0.0";
  var SPECIES_ID = "odocoileus-virginianus";
  /** Soft cap on prior-find hotspot implication (Phase 1 honesty). */
  var SHED_FIND_INTEREST_CAP = 0.35;

  var WEIGHT_SCALE = {
    off: 0,
    low: 0.45,
    balanced: 1,
    strong: 1.65
  };

  /** Documented spatial influence (meters) and recency half-lives (days). */
  var INFLUENCE = {
    feeding_area: { radiusM: 900, halfLifeDays: 45 },
    bedding_area: { radiusM: 800, halfLifeDays: 60 },
    winter_concentration: { radiusM: 1100, halfLifeDays: 75 },
    trail_crossing: { radiusM: 700, halfLifeDays: 90 },
    fence_crossing: { radiusM: 550, halfLifeDays: 120 },
    deer_sign: { radiusM: 1000, halfLifeDays: 21 },
    deer_seen: { radiusM: 1000, halfLifeDays: 14 },
    shed_found: { radiusM: 650, halfLifeDays: 180 },
    search_completed: { radiusM: 450, halfLifeDays: 30 },
    habitat_note: { radiusM: 700, halfLifeDays: 90 },
    hunting_pressure: { radiusM: 800, halfLifeDays: 45 },
    hiking_pressure: { radiusM: 800, halfLifeDays: 45 },
    human_disturbance: { radiusM: 800, halfLifeDays: 45 },
    access_issue: { radiusM: 500, halfLifeDays: 120 },
    /** Diminishing returns for N stacked contributions of same type: 1, 0.55, 0.30, … */
    diminish: [1, 0.55, 0.3, 0.18, 0.1]
  };

  var SEASON_PHASES = {
    pre_shed: { id: "pre_shed", label: "Pre-shed", scoreBias: 0.55 },
    early_shed: { id: "early_shed", label: "Early shed", scoreBias: 0.78 },
    peak_shed: { id: "peak_shed", label: "Peak shed", scoreBias: 1 },
    late_shed: { id: "late_shed", label: "Late shed", scoreBias: 0.82 },
    post_shed: { id: "post_shed", label: "Post-shed", scoreBias: 0.4 },
    outside: { id: "outside", label: "Outside primary shed season", scoreBias: 0.18 },
    unknown: { id: "unknown", label: "Unknown or insufficient context", scoreBias: 0.45 }
  };

  /**
   * Documented base shares (must remain explicit — not “magic”).
   * Sum of additive base shares ≈ 1.0 before preference scaling / caps.
   */
  var BASE_SHARE = {
    season_timing: 0.18,
    slope: 0.08,
    aspect_sun: 0.08,
    terrain_form: 0.07,
    thermal_cover: 0.08,
    feeding: 0.09,
    bedding: 0.09,
    edge_transition: 0.06,
    corridors: 0.07,
    fence_crossing: 0.05,
    deer_sign: 0.06,
    shed_find_interest: 0.04,
    human_pressure: 0.05
  };

  /** Soft ceiling: one additive factor cannot exceed this fraction of summed additive contributions. */
  var MAX_FACTOR_FRACTION = 0.28;

  var EVIDENCE = {
    E01: {
      id: "E01",
      kind: "agency_extension",
      cite: "MU Extension G9486 — Antler Development in White-tailed Deer",
      url: "https://extension.missouri.edu/publications/g9486",
      summary: "Photoperiod/hormone cycle; most males shed late Dec–early March in an average season; nutrition energetically expensive."
    },
    E02: {
      id: "E02",
      kind: "agency",
      cite: "NH Fish & Game — Deer Species Assessment",
      url: "https://www.wildlife.nh.gov/sites/g/files/ehbemt746/files/documents/nh-deer-assessment.pdf",
      summary: "Northern herds: antlers shed Dec–Feb; photoperiod + testosterone govern cycle; habitat quality affects antler metrics."
    },
    E03: {
      id: "E03",
      kind: "science_communication",
      cite: "QDMA Canada — The Science Behind Sheds",
      url: "https://www.qdma.ca/en/2014-03-27-13-07-39/what-we-do/deer-biology-management/117-the-science-behind-sheds/",
      summary: "Abscission after testosterone decline; nutrition stress can advance cast; older/dominant bucks often cast earlier; northern casting windows tighter."
    },
    E04: {
      id: "E04",
      kind: "peer_reviewed",
      cite: "Bubenik 2006 — Seasonal regulation of deer reproduction / antler cycle (review)",
      url: "https://wwwi.vef.hr/vetarhiv/papers/2006-76-7-30.pdf",
      summary: "Boreal cervid antler cycle tightly coupled to photoperiodic endocrine cascade."
    },
    E05: {
      id: "E05",
      kind: "peer_reviewed",
      cite: "Armstrong et al. 1983 — Winter bed-site selection, central Ontario (JWM)",
      url: "https://doi.org/10.2307/3808632",
      summary: "Night beds often in closed conifer; day beds more solar-exposed — both needed in winter concentration areas."
    },
    E06: {
      id: "E06",
      kind: "peer_reviewed",
      cite: "Schmitz 1991 — Thermal constraints & winter habitat choice (Ecography)",
      url: "https://doi.org/10.1111/j.1600-0587.1991.tb00640.x",
      summary: "Daytime open/sunny vs nighttime conifer shelter thermal tradeoff near northern range limit."
    },
    E07: {
      id: "E07",
      kind: "university",
      cite: "MSU Deer Ecology Lab — Habitat Cover",
      url: "https://www.msudeer.msstate.edu/habitat-cover.php",
      summary: "Northern thermal/snow shelter often dense mature conifer; yards frequently on south-facing slopes; 70%+ canopy near forage valued."
    },
    E08: {
      id: "E08",
      kind: "agency",
      cite: "Minnesota DNR — Winter Severity Index / winter impacts",
      url: "https://www.dnr.state.mn.us/mammals/deer/management/wsi.html",
      summary: "Deep snow raises movement costs more than cold alone; deer yard in dense conifer; crust can favor predators over deer."
    },
    E09: {
      id: "E09",
      kind: "peer_reviewed",
      cite: "Moen 1976 — Energy conservation by white-tailed deer in winter (Ecology)",
      url: "https://doi.org/10.2307/1936411",
      summary: "Winter energy conservation via reduced activity, slower travel, preferring lesser snow / gentler ground; disturbance costly."
    },
    E10: {
      id: "E10",
      kind: "peer_reviewed",
      cite: "DelGiudice et al. / MN research — dense conifer cover & snow",
      url: "https://doi.org/10.1371/journal.pone.0065368",
      summary: "~40 cm snow seriously restricts movement; conifer canopies can reduce snow depth substantially."
    },
    E11: {
      id: "E11",
      kind: "peer_reviewed",
      cite: "Claude et al. / hunting spatial behavior (Can. J. Zool.)",
      url: "https://doi.org/10.1139/cjz-2016-0125",
      summary: "During hunting risk, deer often reduce travel and concentrate in known ranges rather than expand micro-ranges."
    },
    E12: {
      id: "E12",
      kind: "peer_reviewed",
      cite: "Peterson et al. 2011 — Roadside fences / home-range responses (Wildl. Soc. Bull.)",
      url: "https://doi.org/10.1002/wsb.38",
      summary: "Deer maintain site fidelity and use fence endings/gaps rather than freely crossing tall barrier fencing."
    },
    E13: {
      id: "E13",
      kind: "habitat_management",
      cite: "NAW / applied topography guidance (management synthesis)",
      url: "https://www.northamericanwhitetail.com/editorial/topography-and-terrain-deer-management/519607",
      summary: "Applied topography: drainages as corridors, benches as travel/bed microsites, saddles as low-energy ridge crossings — experience-based synthesis, not a single experiment."
    },
    E14: {
      id: "E14",
      kind: "thesis_disagreement",
      cite: "Pauley 1988 thesis — Winter habitat selection by sexes (Montana)",
      url: "https://scholarworks.umt.edu/etd/8053",
      summary: "DISAGREEMENT: on that Montana winter range, deer selected low elevations, steep slopes, and north aspects — opposing broad “south-slope winter” heuristic. Aspect preference is regional, not universal."
    }
  };

  var FACTOR_CATALOG = {
    season_timing: {
      id: "season_timing",
      category: "seasonal",
      label: "Seasonal casting window",
      dataKind: "ecological_assumption",
      baseShare: BASE_SHARE.season_timing,
      biologicalConfidence: 0.72,
      prefsKey: "season",
      evidenceIds: ["E01", "E02", "E03", "E04"],
      rationale:
        "Antler cast is triggered by post-rut testosterone decline under photoperiod control. Regional peak is earlier farther south / later farther north, but individuals vary with age, dominance, and nutrition."
    },
    slope: {
      id: "slope",
      category: "terrain",
      label: "Slope energy / walkability",
      dataKind: "inferred",
      baseShare: BASE_SHARE.slope,
      biologicalConfidence: 0.55,
      prefsKey: "slope",
      evidenceIds: ["E09", "E13"],
      rationale:
        "Winter deer conserve energy and often favor gentler travel when snow impedes movement. Extremely steep ground is poorer search habitat and costlier for deer."
    },
    aspect_sun: {
      id: "aspect_sun",
      category: "terrain",
      label: "Aspect / solar exposure",
      dataKind: "ecological_assumption",
      baseShare: BASE_SHARE.aspect_sun,
      biologicalConfidence: 0.48,
      prefsKey: "aspect",
      evidenceIds: ["E05", "E06", "E07", "E14"],
      rationale:
        "Many northern winter descriptions favor sunnier day beds and south-facing yards, but some mountain studies select north aspects. Soft northern-hemisphere sun bias only; regional disagreement is documented."
    },
    terrain_form: {
      id: "terrain_form",
      category: "terrain",
      label: "Terrain microform (ridge / drainage / saddle / bench hints)",
      dataKind: "inferred",
      baseShare: BASE_SHARE.terrain_form,
      biologicalConfidence: 0.4,
      prefsKey: "terrainForm",
      evidenceIds: ["E13", "E09"],
      rationale:
        "Applied ecology and energy conservation suggest deer use low-cost routes: drainages, benches, and saddles. Map-derived hints from elevation neighborhoods are coarse proxies, not mapped landforms."
    },
    thermal_cover: {
      id: "thermal_cover",
      category: "habitat",
      label: "Thermal / winter cover",
      dataKind: "observed",
      baseShare: BASE_SHARE.thermal_cover,
      biologicalConfidence: 0.7,
      prefsKey: "thermalCover",
      evidenceIds: ["E05", "E06", "E07", "E08", "E10"],
      rationale:
        "Dense conifer snow/thermal shelter and winter concentration areas are repeatedly linked to winter survival and reduced snow depth under canopy. We only boost where the user records winter cover/concentration — we do not invent land-cover polygons."
    },
    feeding: {
      id: "feeding",
      category: "habitat",
      label: "Feeding areas",
      dataKind: "observed",
      baseShare: BASE_SHARE.feeding,
      biologicalConfidence: 0.68,
      prefsKey: "feeding",
      evidenceIds: ["E07", "E08", "E09"],
      rationale:
        "Winter feeding sites adjacent to cover create repeated feed→bed movements where cast antlers can accumulate along travel and loafing edges."
    },
    bedding: {
      id: "bedding",
      category: "habitat",
      label: "Bedding / day–night cover mosaic",
      dataKind: "observed",
      baseShare: BASE_SHARE.bedding,
      biologicalConfidence: 0.66,
      prefsKey: "bedding",
      evidenceIds: ["E05", "E06"],
      rationale:
        "Bedding notes mark rest sites. Multiple nearby bedding notes reinforce a local cover complex used in winter."
    },
    edge_transition: {
      id: "edge_transition",
      category: "habitat",
      label: "Edges / transition zones",
      dataKind: "inferred",
      baseShare: BASE_SHARE.edge_transition,
      biologicalConfidence: 0.35,
      prefsKey: "edges",
      evidenceIds: ["E07"],
      rationale:
        "Edges between forage openings and cover are biologically relevant, but without land-cover data this factor stays weak or neutral rather than invented."
    },
    corridors: {
      id: "corridors",
      category: "behavior",
      label: "Travel corridors",
      dataKind: "observed",
      baseShare: BASE_SHARE.corridors,
      biologicalConfidence: 0.6,
      prefsKey: "corridors",
      evidenceIds: ["E09", "E12", "E13"],
      rationale:
        "Repeated trails and crossings concentrate winter movement when deer minimize travel cost."
    },
    fence_crossing: {
      id: "fence_crossing",
      category: "behavior",
      label: "Fence / obstacle crossings",
      dataKind: "observed",
      baseShare: BASE_SHARE.fence_crossing,
      biologicalConfidence: 0.58,
      prefsKey: "fences",
      evidenceIds: ["E12"],
      rationale:
        "Deer often prefer gaps, endings, and known crossing sites over random high jumps across continuous fence."
    },
    deer_sign: {
      id: "deer_sign",
      category: "behavior",
      label: "Recent deer sign / sightings",
      dataKind: "observed",
      baseShare: BASE_SHARE.deer_sign,
      biologicalConfidence: 0.55,
      prefsKey: "deerSign",
      evidenceIds: ["E09"],
      rationale:
        "Fresh sign indicates recent presence. It raises search interest nearby without proving sheds exist."
    },
    shed_find_interest: {
      id: "shed_find_interest",
      category: "calibration_signal",
      label: "Prior shed finds (interest only)",
      dataKind: "observed",
      baseShare: BASE_SHARE.shed_find_interest,
      biologicalConfidence: 0.45,
      prefsKey: "shedFinds",
      evidenceIds: ["E01", "E03"],
      rationale:
        "A prior find is evidence that casting happened somewhere nearby historically. It raises local interest for revisiting habitat context — never a guarantee of additional antlers."
    },
    human_pressure: {
      id: "human_pressure",
      category: "human",
      label: "Human disturbance / pressure",
      dataKind: "observed",
      baseShare: BASE_SHARE.human_pressure,
      biologicalConfidence: 0.5,
      prefsKey: "humanPressure",
      evidenceIds: ["E11", "E09"],
      rationale:
        "Hunting and recreation can reduce diurnal movement and push deer into secure cover. Documented pressure down-weights open disturbed pockets for shed walking relative to quieter adjacent cover — still not a find probability."
    }
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function weightOf(prefs, key) {
    var w = (prefs && prefs.weights && prefs.weights[key]) || "balanced";
    return WEIGHT_SCALE[w] != null ? WEIGHT_SCALE[w] : 1;
  }

  function haversineM(aLat, aLng, bLat, bLng) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (bLat - aLat) * toRad;
    var dLng = (bLng - aLng) * toRad;
    var lat1 = aLat * toRad;
    var lat2 = bLat * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function kernel(distM, radiusM) {
    if (distM >= radiusM) return 0;
    var t = distM / radiusM;
    return (1 - t) * (1 - t);
  }

  function broadRegion(lat) {
    if (typeof lat !== "number" || !isFinite(lat)) return "unknown";
    if (lat < 0) return "southern_hemisphere";
    if (lat >= 48) return "far_north";
    if (lat >= 45) return "northern";
    if (lat >= 38) return "midwest";
    if (lat >= 30) return "south";
    return "gulf_subtropical";
  }

  function regionalContext(lat, lng, date) {
    date = date || new Date();
    return {
      latitude: lat,
      longitude: lng,
      broadRegion: broadRegion(lat),
      dateIso: date.toISOString(),
      dataFreshness: "as_of_score_time"
    };
  }

  function ageDays(obs, now) {
    now = now || Date.now();
    var raw = obs.observedAt || obs.updatedAt || obs.createdAt;
    if (!raw) return 0;
    var t = Date.parse(raw);
    if (!isFinite(t)) return 0;
    return Math.max(0, (now - t) / 86400000);
  }

  function recencyDecay(obs, halfLifeDays, now) {
    var age = ageDays(obs, now);
    if (!halfLifeDays || halfLifeDays <= 0) return 1;
    return Math.exp(-age / halfLifeDays);
  }

  function confidenceMul(obs) {
    if (!obs) return 1;
    if (obs.confidence === "confirmed") return 1.12;
    if (obs.confidence === "uncertain") return 0.88;
    return 1;
  }

  function shedFreshnessMul(obs) {
    var f = obs && obs.details && obs.details.freshness;
    if (f === "fresh") return 1.08;
    if (f === "weathered") return 0.9;
    if (f === "old") return 0.75;
    return 1;
  }

  /** Combine ranked kernel hits with documented diminishing returns. */
  function diminishStack(values) {
    values = (values || []).slice().sort(function (a, b) { return b - a; });
    var total = 0;
    var i;
    for (i = 0; i < values.length; i++) {
      var mul = INFLUENCE.diminish[i] != null ? INFLUENCE.diminish[i] : 0.05;
      total += values[i] * mul;
    }
    return clamp(total, 0, 1.25);
  }

  /**
   * Latitude-aware casting window with explicit seasonal phases.
   * Override via prefs.seasonPhaseOverride (not presented as established fact).
   */
  function seasonProfile(date, lat, prefs) {
    date = date || new Date();
    prefs = prefs || {};
    var doy = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
    var northern = !(typeof lat === "number" && lat < 0);
    var peakCenter;
    var windowHalf;
    if (!northern) {
      peakCenter = 220;
      windowHalf = 55;
    } else if (typeof lat === "number") {
      peakCenter = clamp(20 + (lat - 30) * 2.2, 25, 85);
      windowHalf = lat > 45 ? 28 : lat > 38 ? 35 : 42;
    } else {
      peakCenter = 55;
      windowHalf = 35;
    }

    var dist = Math.min(
      Math.abs(doy - peakCenter),
      Math.abs(doy - peakCenter + 365),
      Math.abs(doy - peakCenter - 365)
    );
    var before = northern
      ? ((doy - peakCenter + 365) % 365) > 182
      : false;
    // Signed days from peak (negative = before peak)
    var signed = doy - peakCenter;
    if (signed > 182) signed -= 365;
    if (signed < -182) signed += 365;

    var phaseId = "outside";
    if (dist <= windowHalf * 0.35) phaseId = "peak_shed";
    else if (signed < 0 && dist <= windowHalf * 0.7) phaseId = "early_shed";
    else if (signed > 0 && dist <= windowHalf * 0.7) phaseId = "late_shed";
    else if (signed < 0 && dist <= windowHalf * 1.35) phaseId = "pre_shed";
    else if (signed > 0 && dist <= windowHalf * 1.5) phaseId = "post_shed";
    else if (typeof lat !== "number") phaseId = "unknown";

    var override = prefs.seasonPhaseOverride;
    var overridden = false;
    if (override && SEASON_PHASES[override]) {
      phaseId = override;
      overridden = true;
    }
    var meta = SEASON_PHASES[phaseId] || SEASON_PHASES.unknown;
    var autoScore = clamp(1 - dist / (windowHalf * 2.1), 0.1, 1);
    var seasonScore = overridden
      ? clamp(0.25 + 0.75 * meta.scoreBias, 0.12, 1)
      : clamp(autoScore * (0.55 + 0.45 * meta.scoreBias), 0.1, 1);

    var supportLine = seasonScore >= 0.72
      ? "Regional photoperiod window is nearer typical peak casting for this latitude."
      : seasonScore >= 0.45
        ? "Regional photoperiod window is open enough to search — not a find probability."
        : phaseId === "pre_shed" || phaseId === "early_shed"
          ? "This area may be early for typical regional shedding."
          : "Regional photoperiod window is weaker for typical casting at this latitude.";

    return {
      score: seasonScore,
      phase: meta.label,
      phaseId: phaseId,
      peakDoy: Math.round(peakCenter),
      windowHalfDays: Math.round(windowHalf),
      overridden: overridden,
      region: broadRegion(lat),
      supportLine: supportLine,
      source: overridden ? "user_preference_override" : "ecological_assumption",
      provenanceClass: overridden ? "WAYPOINT_HEURISTIC" : "MODEL_ASSUMPTION",
      note: "Timing varies by animal, age, health, nutrition, weather, and local conditions. Date alone cannot predict exact antler drop. " +
        (overridden ? "Season phase was user-adjusted and is not established fact." : "")
    };
  }

  function slopePreferenceScore(slopeDeg) {
    if (slopeDeg == null) return { score: 0.5, label: "slope unavailable", available: false };
    var ideal = 8;
    var score = clamp(1 - Math.abs(slopeDeg - ideal) / 28, 0.05, 1);
    if (slopeDeg > 35) score *= 0.45;
    return {
      score: score,
      label: slopeDeg < 5 ? "flat" : slopeDeg < 15 ? "gentle" : slopeDeg < 28 ? "moderate" : "steep",
      available: true
    };
  }

  function aspectPreferenceScore(aspect, lat) {
    if (aspect == null) return { score: 0.5, label: "aspect unavailable", available: false };
    var northern = !(typeof lat === "number" && lat < 0);
    // Soft sun bias for northern winter day-beds — disputed regionally (E14).
    var target = northern ? 200 : 20;
    var sun = Math.cos((aspect - target) * Math.PI / 180);
    var score = clamp(0.55 + 0.28 * sun, 0.2, 1);
    return {
      score: score,
      label: sun > 0.25 ? "more sun-exposed" : sun < -0.25 ? "more shaded" : "mixed aspect",
      available: true,
      disagreementNote: northern
        ? "Regional disagreement exists: some mountain winter ranges prefer northerly aspects (E14)."
        : null
    };
  }

  function terrainFormScore(morph) {
    if (!morph || morph.source === "unavailable") {
      return { score: 0.5, label: "terrain form unavailable", available: false, parts: null };
    }
    var s = 0.42;
    var bits = [];
    if (morph.drainageHint > 0.5) { s += 0.18; bits.push("drainage-relative low"); }
    if (morph.benchHint > 0.5) { s += 0.16; bits.push("bench-like gentler patch"); }
    if (morph.saddleHint > 0.5) { s += 0.2; bits.push("saddle-like pass"); }
    if (morph.ridgeHint > 0.55) { s += 0.05; bits.push("ridge-relative high"); }
    return {
      score: clamp(s, 0.15, 1),
      label: bits.length ? bits.join(", ") : "no strong microform hint",
      available: true,
      parts: morph
    };
  }

  function observationSignals(lat, lng, observations, prefs, nowMs) {
    observations = observations || [];
    nowMs = nowMs || Date.now();
    var buckets = {
      feeding: [],
      bedding: [],
      thermal: [],
      corridors: [],
      deerSign: [],
      fences: [],
      searchPenalty: [],
      shedBoost: [],
      humanPressure: [],
      edgeNote: [],
      access: []
    };
    var out = {
      feeding: 0,
      bedding: 0,
      thermal: 0,
      corridors: 0,
      deerSign: 0,
      fences: 0,
      searchPenalty: 0,
      shedBoost: 0,
      humanPressure: 0,
      edgeNote: 0,
      accessPenalty: 0,
      beddingCluster: 0,
      obsCountNearby: 0,
      nearby: []
    };
    var beddingNearby = 0;
    var i;
    for (i = 0; i < observations.length; i++) {
      var o = observations[i];
      if (!o || !o.location) continue;
      var d = haversineM(lat, lng, o.location.lat, o.location.lng);
      if (d < 1200) {
        out.obsCountNearby += 1;
        if (d < 500) {
          out.nearby.push({
            id: o.id,
            type: o.type,
            distanceM: Math.round(d),
            confidence: o.confidence || "probable",
            ageDays: Math.round(ageDays(o, nowMs) * 10) / 10
          });
        }
      }
      var t = o.type;
      var inf = INFLUENCE[t];
      if (!inf) continue;
      var k = kernel(d, inf.radiusM) * recencyDecay(o, inf.halfLifeDays, nowMs) * confidenceMul(o);
      if (t === "feeding_area") {
        buckets.feeding.push(k * weightOf(prefs, "feeding"));
      } else if (t === "bedding_area") {
        buckets.bedding.push(k * weightOf(prefs, "bedding"));
        if (d < 350) beddingNearby += 1;
      } else if (t === "winter_concentration") {
        buckets.thermal.push(k * weightOf(prefs, "thermalCover"));
        buckets.bedding.push(k * 0.55 * weightOf(prefs, "bedding"));
        if (d < 400) beddingNearby += 1;
      } else if (t === "trail_crossing") {
        buckets.corridors.push(k * weightOf(prefs, "corridors"));
      } else if (t === "fence_crossing") {
        buckets.fences.push(k * weightOf(prefs, "fences"));
      } else if (t === "deer_sign" || t === "deer_seen") {
        buckets.deerSign.push(k * weightOf(prefs, "deerSign") * (t === "deer_seen" ? 0.85 : 1));
      } else if (t === "shed_found") {
        // Interest only — hard soft-cap later via base share + MAX_FACTOR_FRACTION
        buckets.shedBoost.push(k * 0.55 * weightOf(prefs, "shedFinds") * shedFreshnessMul(o));
      } else if (t === "search_completed") {
        buckets.searchPenalty.push(k * weightOf(prefs, "searchHistory"));
      } else if (t === "habitat_note") {
        buckets.edgeNote.push(k * weightOf(prefs, "edges") * 0.55);
      } else if (t === "hunting_pressure" || t === "hiking_pressure" || t === "human_disturbance") {
        buckets.humanPressure.push(k * weightOf(prefs, "humanPressure") * (t === "hunting_pressure" ? 1.15 : 1));
      } else if (t === "access_issue") {
        buckets.access.push(k);
        buckets.humanPressure.push(k * 0.35 * weightOf(prefs, "humanPressure"));
      }
    }
    out.feeding = diminishStack(buckets.feeding);
    out.bedding = diminishStack(buckets.bedding);
    out.thermal = diminishStack(buckets.thermal);
    out.corridors = diminishStack(buckets.corridors);
    out.deerSign = diminishStack(buckets.deerSign);
    out.fences = diminishStack(buckets.fences);
    out.searchPenalty = diminishStack(buckets.searchPenalty);
    out.shedBoost = diminishStack(buckets.shedBoost);
    out.humanPressure = diminishStack(buckets.humanPressure);
    out.edgeNote = diminishStack(buckets.edgeNote);
    out.accessPenalty = diminishStack(buckets.access);
    if (beddingNearby >= 2) {
      out.beddingCluster = clamp(0.12 * (beddingNearby - 1), 0, 0.28);
      out.bedding = clamp(out.bedding + out.beddingCluster, 0, 1.2);
    }
    out.nearby.sort(function (a, b) { return a.distanceM - b.distanceM; });
    out.nearby = out.nearby.slice(0, 6);
    return out;
  }

  /** Optional coarse land-cover category — never invent; unavailable → null. */
  function habitatFromLandCover(category) {
    if (!category || category === "unknown") {
      return { score: 0.5, available: false, label: "land cover unavailable", category: "unknown" };
    }
    var map = {
      dense_cover: { score: 0.78, label: "dense cover" },
      forest: { score: 0.72, label: "forest" },
      shrub: { score: 0.7, label: "shrub / early succession" },
      edge: { score: 0.8, label: "edge / transition" },
      agriculture: { score: 0.62, label: "agricultural" },
      open_field: { score: 0.48, label: "open field" },
      wetland: { score: 0.55, label: "wetland" },
      developed: { score: 0.22, label: "developed" }
    };
    var hit = map[category];
    if (!hit) return { score: 0.5, available: false, label: "land cover unavailable", category: "unknown" };
    return { score: hit.score, available: true, label: hit.label, category: category, dataKind: "inferred" };
  }

  function weatherModifiers(weather, prefs) {
    var snowW = weightOf(prefs, "snow");
    var out = {
      snowFactor: 1,
      coldFactor: 1,
      windFactor: 1,
      stormSettleFactor: 1,
      source: "unavailable",
      snowMm: null,
      tempC: null,
      notes: []
    };
    if (!weather) {
      out.notes.push("Weather samples unavailable — snow/temperature influence held neutral.");
      return out;
    }
    out.source = weather.source || "weather-provider";
    out.snowMm = weather.snowMm;
    out.tempC = typeof weather.tempC === "number" ? weather.tempC : null;
    if (snowW > 0 && typeof weather.snowInfluence === "number") {
      out.snowFactor = clamp(weather.snowInfluence, 0.55, 1.15);
      out.notes.push("Snowfall summary modulates travel cost / concentration heuristics (agency WSI literature: deep snow costly).");
    }
    // Cold: below roughly -18C (~0F MN WSI day threshold concept) — soft energy cost, not WSI clone
    if (snowW > 0 && out.tempC != null && out.tempC <= -18) {
      out.coldFactor = 0.92;
      out.notes.push("Very cold recent temperature increases energy cost; prioritize cover–feed mosaics if observed.");
    }
    if (typeof weather.windSpeedMs === "number" && weather.windSpeedMs >= 10) {
      out.windFactor = 0.94;
      out.notes.push("Elevated wind — exposure may push day use toward lee/thermal cover when recorded.");
    }
    // Crust / freeze-thaw: cannot observe remotely with confidence → explicit unavailable
    out.notes.push("Snow crust and freeze/thaw state are not sensed here (uncertainty).");
    return out;
  }

  function buildFactorEntry(catalogId, score01, extras) {
    extras = extras || {};
    var meta = FACTOR_CATALOG[catalogId];
    var avail = extras.available !== false;
    var raw = avail ? clamp(score01, 0, 1.25) : 0.5;
    var w = extras.weightScale != null ? extras.weightScale : 1;
    var share = meta.baseShare * w;
    var contribution = share * (avail ? clamp(raw, 0, 1) : 0.5);
    return {
      id: catalogId,
      label: meta.label,
      category: meta.category,
      dataKind: extras.dataKind || meta.dataKind,
      score: clamp(raw, 0, 1),
      available: avail,
      baseShare: meta.baseShare,
      weightScale: w,
      contribution: contribution,
      biologicalConfidence: meta.biologicalConfidence,
      rationale: meta.rationale,
      evidenceIds: meta.evidenceIds.slice(),
      note: extras.note || null,
      labelDetail: extras.labelDetail || null,
      provenanceClass: extras.provenanceClass || "WAYPOINT_HEURISTIC"
    };
  }

  function capContributions(factors) {
    var sum = 0;
    var i;
    for (i = 0; i < factors.length; i++) sum += Math.max(0, factors[i].contribution);
    if (sum <= 0) return factors;
    for (i = 0; i < factors.length; i++) {
      var maxAllowed = sum * MAX_FACTOR_FRACTION;
      if (factors[i].contribution > maxAllowed) {
        factors[i].capped = true;
        factors[i].contribution = maxAllowed;
      }
    }
    return factors;
  }

  function confidenceBundle(factors, opts, obs, terrainAvailable, weatherAvail, edgeAvail) {
    var bioVals = [];
    var i;
    for (i = 0; i < factors.length; i++) {
      if (factors[i].available && factors[i].weightScale > 0) {
        bioVals.push(factors[i].biologicalConfidence);
      }
    }
    var biological = bioVals.length
      ? bioVals.reduce(function (a, b) { return a + b; }, 0) / bioVals.length
      : 0.35;

    var envBits = 0;
    var envTotal = 3;
    if (terrainAvailable) envBits += 1;
    if (weatherAvail) envBits += 1;
    if (edgeAvail) envBits += 1;
    var environmentalData = envBits / envTotal;

    var obsN = (opts.observations && opts.observations.length) || 0;
    var near = obs.obsCountNearby || 0;
    var observationDensity = clamp(0.15 + 0.12 * Math.min(obsN, 8) + 0.08 * Math.min(near, 6), 0.15, 0.95);

    // Overall recommendation confidence ≠ probability of a shed
    var overall = clamp(
      0.34 * biological + 0.28 * environmentalData + 0.38 * observationDensity,
      0.12,
      0.9
    );
    if (!terrainAvailable) overall *= 0.92;
    if (!edgeAvail) overall *= 0.9;

    return {
      biological: Math.round(biological * 100) / 100,
      environmentalData: Math.round(environmentalData * 100) / 100,
      observationDensity: Math.round(observationDensity * 100) / 100,
      overallRecommendation: Math.round(overall * 100) / 100,
      disclaimer: "Confidence channels rate input support for guidance — not the chance an antler is present."
    };
  }

  function taxonomyFrom(factors, uncertaintyNotes) {
    var tax = {
      observed: [],
      inferred: [],
      ecologicalAssumptions: [],
      userPreferences: [],
      uncertainty: uncertaintyNotes.slice()
    };
    factors.forEach(function (f) {
      if (f.weightScale <= 0) return;
      var tip = f.label + (f.labelDetail ? " (" + f.labelDetail + ")" : "");
      if (f.dataKind === "observed" && f.available && f.score > 0.2) tax.observed.push(tip);
      else if (f.dataKind === "inferred" && f.available) tax.inferred.push(tip);
      else if (f.dataKind === "ecological_assumption") tax.ecologicalAssumptions.push(tip);
      if (f.weightScale !== 1) tax.userPreferences.push(f.label + " weight×" + f.weightScale);
      if (!f.available) tax.uncertainty.push(f.label + " data unavailable — held near neutral.");
    });
    return tax;
  }

  function explainBiological(result) {
    if (!result) return "No biological model result.";
    var lines = [];
    var habitatMode = result.channelMode === "habitat";
    var bandLabel = habitatMode
      ? (result.band === "higher" ? "Higher relative walk interest"
        : result.band === "moderate" ? "Moderate relative walk interest"
          : result.band === "neutral" ? "No habitat-specific guidance"
            : "Lower relative walk interest")
      : (result.band === "higher" ? "Higher relative walk interest"
        : result.band === "moderate" ? "Moderate relative walk interest"
          : "Lower relative walk interest");
    lines.push(bandLabel + " under Whitetail Biological Model v" + MODEL_VERSION +
      (habitatMode ? " (habitat channel)." : "."));

    if (result.influences && result.influences.positive && result.influences.positive.length) {
      lines.push("Primary positive influences: " + result.influences.positive.map(function (x) {
        return x.label;
      }).join("; ") + ".");
    }
    if (result.influences && result.influences.limiting && result.influences.limiting.length) {
      lines.push("Primary limiting influences: " + result.influences.limiting.map(function (x) {
        return x.label;
      }).join("; ") + ".");
    }
    if (!habitatMode && result.seasonContext && result.seasonContext.supportLine) {
      lines.push(result.seasonContext.supportLine);
      lines.push(result.seasonContext.note || "Timing varies by animal, age, health, nutrition, weather, and local conditions.");
    }
    if (habitatMode) {
      lines.push("Timing is reported separately — season does not paint this habitat surface.");
    }
    if (result.nearbyObservations && result.nearbyObservations.length) {
      lines.push("Nearby observations: " + result.nearbyObservations.slice(0, 3).map(function (n) {
        return n.type + " (~" + n.distanceM + " m, age ~" + n.ageDays + " d)";
      }).join("; ") + ".");
    }
    if (result.parts && result.parts.searchPenalty > 0.2) {
      lines.push("Walk interest is reduced slightly because nearby search-completed notes reduce revisit urgency — not biological emptiness.");
    }
    if (result.parts && result.parts.coverageFactor < 0.95) {
      lines.push("Search-coverage marks also temper ranking for already-walked ground.");
    }
    if (result.confidence) {
      lines.push(
        "Data-coverage confidence (not find probability) — overall guidance " +
        result.confidence.overallRecommendation +
        " (biological " + result.confidence.biological +
        ", environmental " + result.confidence.environmentalData +
        ", observations " + result.confidence.observationDensity + ")."
      );
    }
    if (result.taxonomy && result.taxonomy.uncertainty && result.taxonomy.uncertainty.length) {
      lines.push("Unavailable or uncertain: " + result.taxonomy.uncertainty.slice(0, 3).join(" "));
    }
    lines.push("This is relative walk guidance for whitetail shed searching — not a map of antlers and not a find probability.");
    return lines.join(" ");
  }

  function deriveInfluences(factors, parts) {
    var positive = [];
    var limiting = [];
    (factors || []).forEach(function (f) {
      if (!f || f.weightScale <= 0) return;
      if (f.available && f.score >= 0.62) {
        positive.push({
          id: f.id,
          label: f.labelDetail || f.label,
          direction: "positive",
          strength: Math.round(f.contribution * 1000) / 1000,
          sourceCategory: f.dataKind,
          confidence: f.biologicalConfidence
        });
      } else if (f.available && f.score <= 0.35) {
        limiting.push({
          id: f.id,
          label: f.labelDetail || f.label,
          direction: "limiting",
          strength: Math.round((0.5 - f.score) * 1000) / 1000,
          sourceCategory: f.dataKind,
          confidence: f.biologicalConfidence
        });
      } else if (!f.available) {
        limiting.push({
          id: f.id,
          label: f.label + " unavailable",
          direction: "limiting",
          strength: 0.1,
          sourceCategory: "unavailable",
          confidence: f.biologicalConfidence
        });
      }
    });
    positive.sort(function (a, b) { return b.strength - a.strength; });
    limiting.sort(function (a, b) { return b.strength - a.strength; });
    if (parts && parts.searchPenalty > 0.2) {
      limiting.unshift({
        id: "search_history",
        label: "nearby search-completed notes",
        direction: "limiting",
        strength: parts.searchPenalty,
        sourceCategory: "observed",
        confidence: 0.55
      });
    }
    if (parts && parts.coverageFactor < 0.9) {
      limiting.unshift({
        id: "coverage_marks",
        label: "on-map search coverage marks",
        direction: "limiting",
        strength: 1 - parts.coverageFactor,
        sourceCategory: "user_preference",
        confidence: 0.5
      });
    }
    return { positive: positive.slice(0, 4), limiting: limiting.slice(0, 4) };
  }

  /**
   * Core scorer — used by the heat / planner pipeline.
   * Phase 1: channelMode "habitat" excludes season + weather from spatial interest.
   * `priority` remains for legacy callers but is documented as relative walk interest,
   * never find probability. Prefer habitatInterest / channels for new UI.
   */
  function scoreCell(opts) {
    opts = opts || {};
    var prefs = opts.prefs || { weights: {} };
    var lat = opts.lat;
    var lng = opts.lng;
    var habitatMode =
      opts.channelMode === "habitat" ||
      opts.excludeSeasonFromSpatial === true ||
      opts.excludeWeatherFromSpatial === true;
    var season = seasonProfile(opts.date, lat, prefs);
    var region = regionalContext(lat, lng, opts.date);
    var terrain = opts.terrain || { slope: null, aspect: null, source: "unavailable" };
    var slope = slopePreferenceScore(terrain.slope);
    var aspect = aspectPreferenceScore(terrain.aspect, lat);
    var form = terrainFormScore(terrain.morphology);
    var obs = observationSignals(lat, lng, opts.observations, prefs, opts.nowMs);
    // Cap prior-find hotspot implication (Phase 1).
    if (obs.shedBoost > SHED_FIND_INTEREST_CAP) {
      obs.shedBoost = SHED_FIND_INTEREST_CAP;
    }
    var wx = weatherModifiers(opts.weather, prefs);
    var habitatLc = habitatFromLandCover(opts.landCoverCategory);

    var edgeScore = 0.5;
    var edgeAvail = false;
    if (habitatLc.available) {
      edgeScore = habitatLc.score;
      edgeAvail = true;
    } else if (typeof opts.edgeHint === "number") {
      edgeScore = clamp(opts.edgeHint, 0, 1);
      edgeAvail = true;
    } else if (obs.edgeNote > 0) {
      edgeScore = clamp(0.45 + obs.edgeNote, 0, 1);
      edgeAvail = true;
    }

    var thermalScore = obs.thermal > 0
      ? clamp(obs.thermal, 0, 1)
      : (obs.bedding > 0.35 ? clamp(obs.bedding * 0.55, 0, 0.7) : 0.5);
    var thermalAvail = obs.thermal > 0 || obs.bedding > 0.35;

    var humanAttract = obs.humanPressure > 0
      ? clamp(1 - obs.humanPressure, 0.15, 1)
      : 0.5;
    var humanAvail = obs.humanPressure > 0;

    var factors = [
      buildFactorEntry("season_timing", season.score, {
        weightScale: habitatMode ? 0 : weightOf(prefs, "season"),
        available: !habitatMode,
        labelDetail: season.phase,
        dataKind: season.overridden ? "user_preference" : "ecological_assumption",
        provenanceClass: season.overridden ? "WAYPOINT_HEURISTIC" : "MODEL_ASSUMPTION"
      }),
      buildFactorEntry("slope", slope.score, {
        weightScale: weightOf(prefs, "slope"),
        available: slope.available,
        labelDetail: slope.label,
        provenanceClass: "WAYPOINT_HEURISTIC"
      }),
      buildFactorEntry("aspect_sun", aspect.score, {
        weightScale: weightOf(prefs, "aspect"),
        available: aspect.available,
        labelDetail: aspect.label,
        note: aspect.disagreementNote,
        provenanceClass: "WAYPOINT_HEURISTIC"
      }),
      buildFactorEntry("terrain_form", form.score, {
        weightScale: weightOf(prefs, "terrainForm"),
        available: form.available,
        labelDetail: form.label,
        provenanceClass: "WAYPOINT_HEURISTIC"
      }),
      buildFactorEntry("thermal_cover", thermalScore, {
        weightScale: weightOf(prefs, "thermalCover"),
        available: thermalAvail,
        labelDetail: thermalAvail ? "winter/thermal cover signal" : null,
        dataKind: thermalAvail ? "observed" : "inferred",
        provenanceClass: thermalAvail ? "SOURCE_FACT" : "WAYPOINT_HEURISTIC"
      }),
      buildFactorEntry("feeding", obs.feeding, {
        weightScale: weightOf(prefs, "feeding"),
        available: obs.feeding > 0.02,
        dataKind: "observed",
        provenanceClass: "SOURCE_FACT"
      }),
      buildFactorEntry("bedding", obs.bedding, {
        weightScale: weightOf(prefs, "bedding"),
        available: obs.bedding > 0.02,
        dataKind: "observed",
        provenanceClass: "SOURCE_FACT"
      }),
      buildFactorEntry("edge_transition", edgeScore, {
        weightScale: weightOf(prefs, "edges"),
        available: edgeAvail,
        labelDetail: habitatLc.available ? habitatLc.label : null,
        dataKind: edgeAvail ? (habitatLc.available || opts.edgeHint != null ? "inferred" : "observed") : "inferred",
        provenanceClass: edgeAvail && !habitatLc.available ? "SOURCE_FACT" : "WAYPOINT_HEURISTIC"
      }),
      buildFactorEntry("corridors", obs.corridors, {
        weightScale: weightOf(prefs, "corridors"),
        available: obs.corridors > 0.02,
        provenanceClass: "SOURCE_FACT"
      }),
      buildFactorEntry("fence_crossing", obs.fences, {
        weightScale: weightOf(prefs, "fences"),
        available: obs.fences > 0.02,
        provenanceClass: "SOURCE_FACT"
      }),
      buildFactorEntry("deer_sign", obs.deerSign, {
        weightScale: weightOf(prefs, "deerSign"),
        available: obs.deerSign > 0.02,
        provenanceClass: "SOURCE_FACT"
      }),
      buildFactorEntry("shed_find_interest", obs.shedBoost, {
        weightScale: weightOf(prefs, "shedFinds"),
        available: obs.shedBoost > 0.02,
        note: "Prior-find interest capped at " + SHED_FIND_INTEREST_CAP + " — not a hotspot guarantee.",
        provenanceClass: "SOURCE_FACT"
      }),
      buildFactorEntry("human_pressure", humanAttract, {
        weightScale: weightOf(prefs, "humanPressure"),
        available: humanAvail,
        dataKind: humanAvail ? "observed" : "inferred",
        labelDetail: humanAvail ? "lower attractiveness under recorded disturbance" : null,
        provenanceClass: humanAvail ? "SOURCE_FACT" : "WAYPOINT_HEURISTIC"
      })
    ];

    capContributions(factors);

    var additive = 0;
    factors.forEach(function (f) { additive += f.contribution; });

    // Biological suitability before search-history / coverage / access adjustments
    var biologicalSuitability = clamp(additive / 0.85, 0, 1);

    var searchW = weightOf(prefs, "searchHistory");
    var searchPenalty = obs.searchPenalty;
    var afterSearch = additive * (1 - 0.55 * searchPenalty * (searchW > 0 ? 1 : 0));

    // Weather multipliers belong to SEARCHABILITY — not habitat spatial heat (Phase 1).
    var wxMul = 1;
    if (!habitatMode && weightOf(prefs, "snow") > 0) {
      wxMul = wx.snowFactor * wx.coldFactor * wx.windFactor;
      if ((wx.snowMm || 0) > 15 && !thermalAvail) wxMul *= 0.92;
      if ((wx.snowMm || 0) > 15 && obs.thermal > 0.25) wxMul *= 1.06;
    }
    afterSearch *= wxMul;

    var coverageFactor = 1;
    var coverageLevel = opts.coverageLevel || null;
    if (opts.coverageFactor != null && isFinite(opts.coverageFactor)) {
      coverageFactor = clamp(opts.coverageFactor, 0.2, 1.15);
    }
    afterSearch *= coverageFactor;

    // Practical access adjustment — multiplicative, separate from biology
    var accessFactor = obs.accessPenalty > 0 ? clamp(1 - 0.35 * obs.accessPenalty, 0.55, 1) : 1;
    afterSearch *= accessFactor;

    var priority = clamp(afterSearch / 0.85, 0, 1);
    var habitatInterest = habitatMode ? priority : clamp(additive / 0.85, 0, 1);

    var band = "lower";
    if (priority >= 0.72) band = "higher";
    else if (priority >= 0.45) band = "moderate";

    var terrainAvailable = terrain.source === "map-derived" && slope.available;
    var weatherAvail = wx.source !== "unavailable";
    var uncertaintyNotes = wx.notes.slice();
    if (aspect.disagreementNote) uncertaintyNotes.push(aspect.disagreementNote);
    if (!habitatLc.available) uncertaintyNotes.push("Land-cover / habitat polygons are not loaded; edge influence stays generalized.");
    if (season.overridden) uncertaintyNotes.push("Season phase override is a user preference, not established timing fact.");
    if (habitatMode) {
      uncertaintyNotes.push("Habitat channel excludes season timing and weather from spatial interest.");
    }

    var parts = {
      season: habitatMode ? 0 : season.score * weightOf(prefs, "season"),
      slope: slope.score,
      aspect: aspect.score,
      terrainForm: form.score,
      thermal: thermalScore,
      feeding: obs.feeding,
      bedding: obs.bedding,
      corridors: obs.corridors,
      deerSign: obs.deerSign,
      fences: obs.fences,
      shedBoost: obs.shedBoost,
      humanPressure: obs.humanPressure,
      searchPenalty: searchPenalty,
      snowFactor: habitatMode ? 1 : wx.snowFactor,
      coverageFactor: coverageFactor,
      accessFactor: accessFactor,
      biologicalSuitability: biologicalSuitability,
      habitatInterest: habitatInterest
    };

    var influences = deriveInfluences(factors, parts);
    var confidence = confidenceBundle(
      factors, opts, obs, terrainAvailable, weatherAvail, edgeAvail
    );
    var taxonomy = taxonomyFrom(factors, uncertaintyNotes);

    var inputMode = "limited-data";
    if (terrainAvailable && weatherAvail && edgeAvail && (opts.observations || []).length) inputMode = "full-available";
    else if (terrainAvailable && (opts.observations || []).length) inputMode = "terrain-and-observations";
    else if ((opts.observations || []).length) inputMode = "local-observations-only";
    else if (terrainAvailable) inputMode = "season-and-terrain-only";
    if (opts.offlineForced) inputMode = "offline";

    var habitatFactors = factors.filter(function (f) {
      return f.id !== "season_timing" && f.available && f.weightScale > 0;
    });

    var result = {
      modelVersion: MODEL_VERSION,
      factorConfigVersion: FACTOR_CONFIG_VERSION,
      speciesId: SPECIES_ID,
      /** @deprecated Phase 1 — relative walk interest, NEVER find probability */
      priority: priority,
      habitatInterest: habitatInterest,
      biologicalSuitability: biologicalSuitability,
      band: band,
      channelMode: habitatMode ? "habitat" : "legacy-blended",
      factors: factors,
      habitatFactors: habitatFactors,
      parts: parts,
      influences: influences,
      nearbyObservations: obs.nearby,
      seasonContext: {
        phaseId: season.phaseId,
        phase: season.phase,
        supportLine: season.supportLine,
        note: season.note,
        overridden: season.overridden,
        region: season.region,
        provenanceClass: season.provenanceClass
      },
      regionalContext: region,
      activePreset: prefs.activePreset || "balanced",
      inputMode: inputMode,
      labels: {
        seasonPhase: season.phase,
        slope: slope.label,
        aspect: aspect.label,
        terrainForm: form.label,
        coverageLevel: coverageLevel,
        landCover: habitatLc.label
      },
      sources: {
        season: season.source,
        terrain: terrain.source || "unavailable",
        observations: (opts.observations && opts.observations.length) ? "user-observation" : "unavailable",
        weather: wx.source,
        landCover: habitatLc.available ? "provider-or-hint" : "unavailable"
      },
      terrainMeta: {
        source: terrain.source || "unavailable",
        method: terrain.source === "map-derived" ? "finite-difference slope/aspect + 3x3 morphology hints" : "none",
        resolution: opts.cellMetersApprox ? ("~" + opts.cellMetersApprox + " m cells") : "viewport grid",
        liveOrCached: opts.terrainCacheState || "unknown",
        limitations: "Morphology hints are coarse elevation-neighborhood proxies, not surveyed landforms.",
        provenanceClass: "WAYPOINT_HEURISTIC"
      },
      seasonNote: season.note,
      confidence: confidence,
      taxonomy: taxonomy,
      weatherNotes: habitatMode
        ? ["Weather excluded from habitat spatial scoring (searchability channel)."]
        : wx.notes,
      contributionBreakdown: factors.map(function (f) {
        return {
          key: f.id,
          label: f.label,
          value: Math.round(f.contribution * 1000) / 1000,
          direction: f.score >= 0.55 ? "positive" : f.score <= 0.4 ? "limiting" : "neutral",
          dataKind: f.dataKind,
          evidenceIds: f.evidenceIds,
          provenanceClass: f.provenanceClass || null
        };
      }),
      calibration: {
        schema: "waypoint-sheds-calibration-hooks-v1",
        modelVersion: MODEL_VERSION,
        readyFor: [
          "regional_peak_doy_offset",
          "per_factor_bias_from_confirmed_finds",
          "season_validation_pass_fail",
          "user_weight_profiles_by_region",
          "field_validation_evidence_v1"
        ],
        note: "Hooks only — no learning implemented in v2.0 Phase 1."
      },
      honesty: {
        priorityIsNotFindProbability: true,
        habitatExcludesSeasonWeather: !!habitatMode,
        shedFindInterestCap: SHED_FIND_INTEREST_CAP
      }
    };
    result.explanation = explainBiological(result);
    return result;
  }

  function terrainMorphologyAt(grid, row, col, rows, cols) {
    function eAt(r, c) {
      if (r < 0 || c < 0 || r >= rows || c >= cols || !grid) return null;
      var v = grid[r * cols + c];
      return typeof v === "number" && isFinite(v) ? v : null;
    }
    var c0 = eAt(row, col);
    if (c0 == null) return { source: "unavailable" };
    var nbrs = [];
    var dr;
    var dc;
    for (dr = -1; dr <= 1; dr++) {
      for (dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        var v = eAt(row + dr, col + dc);
        if (v != null) nbrs.push(v);
      }
    }
    if (nbrs.length < 4) return { source: "unavailable" };
    var mean = nbrs.reduce(function (a, b) { return a + b; }, 0) / nbrs.length;
    var rel = c0 - mean;
    var higher = 0;
    var lower = 0;
    nbrs.forEach(function (v) {
      if (v > c0 + 1.5) higher += 1;
      if (v < c0 - 1.5) lower += 1;
    });
    var n = eAt(row - 1, col);
    var s = eAt(row + 1, col);
    var w = eAt(row, col - 1);
    var e = eAt(row, col + 1);
    var saddleNS = n != null && s != null && w != null && e != null &&
      n > c0 + 2 && s > c0 + 2 && w < c0 - 1 && e < c0 - 1;
    var saddleEW = n != null && s != null && w != null && e != null &&
      w > c0 + 2 && e > c0 + 2 && n < c0 - 1 && s < c0 - 1;
    var ridgeHint = rel > 3 || higher >= 5 ? 0.75 : rel > 1.2 ? 0.45 : 0.15;
    var drainageHint = rel < -3 || lower >= 5 ? 0.8 : rel < -1.2 ? 0.5 : 0.15;
    var saddleHint = (saddleNS || saddleEW) ? 0.85 : 0.1;
    // Bench-ish: near mean elevation with modest neighbor spread
    var spread = 0;
    nbrs.forEach(function (v) { spread += Math.abs(v - mean); });
    spread /= nbrs.length;
    var benchHint = (Math.abs(rel) < 2 && spread < 4 && spread > 0.4) ? 0.65 : 0.15;
    return {
      source: "map-derived",
      relativeElev: rel,
      ridgeHint: ridgeHint,
      drainageHint: drainageHint,
      saddleHint: saddleHint,
      benchHint: benchHint
    };
  }

  function listFactors() {
    return Object.keys(FACTOR_CATALOG).map(function (k) { return FACTOR_CATALOG[k]; });
  }

  function getEvidence(id) {
    return EVIDENCE[id] || null;
  }

  global.WaypointShedsBiological = {
    MODEL_VERSION: MODEL_VERSION,
    FACTOR_CONFIG_VERSION: FACTOR_CONFIG_VERSION,
    SPECIES_ID: SPECIES_ID,
    WEIGHT_SCALE: WEIGHT_SCALE,
    BASE_SHARE: BASE_SHARE,
    MAX_FACTOR_FRACTION: MAX_FACTOR_FRACTION,
    SHED_FIND_INTEREST_CAP: SHED_FIND_INTEREST_CAP,
    INFLUENCE: INFLUENCE,
    SEASON_PHASES: SEASON_PHASES,
    EVIDENCE: EVIDENCE,
    FACTOR_CATALOG: FACTOR_CATALOG,
    listFactors: listFactors,
    getEvidence: getEvidence,
    seasonProfile: seasonProfile,
    regionalContext: regionalContext,
    broadRegion: broadRegion,
    habitatFromLandCover: habitatFromLandCover,
    scoreCell: scoreCell,
    explain: explainBiological,
    deriveInfluences: deriveInfluences,
    terrainMorphologyAt: terrainMorphologyAt,
    haversineM: haversineM,
    weightOf: weightOf,
    observationSignals: observationSignals,
    diminishStack: diminishStack,
    recencyDecay: recencyDecay
  };
})(typeof window !== "undefined" ? window : globalThis);
