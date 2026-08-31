/**
 * Sheds V1.1 / V1.2 — Today's Hunt composer.
 *
 * BAND MEANING (hunter-facing):
 *   Overall shed-hunt recommendation for today — not field-searchability
 *   alone, and never a find / antler / deer probability.
 *
 * V1.2 adds freeze/thaw, 24–48 h temperature trend, and snow-depth class as
 * supporting signals. They refine the recommendation; they do not overpower
 * seasonal timing, and they never imply antler drop or find chance.
 *
 * Searchability (weather, daylight, footing) is one INPUT. Season is another.
 * Excellent walking weather must not produce a high overall band when the
 * regional shed-search window is clearly poor.
 *
 * RATED bands (only when eligible): Low | Fair | Good | Very good
 * UNRATED labels (missing critical inputs — NOT Low):
 *   Need location | Not rated
 *
 * Missing data is UNKNOWN, not negative evidence.
 *
 * Internal channels stay separate: TIMING, HABITAT MODEL, SEARCHABILITY,
 * OBSERVED. This module is a composer, not a replacement score.
 */
(function (global) {
  "use strict";

  var RATED_BANDS = Object.freeze(["Low", "Fair", "Good", "Very good"]);
  var RANK = { Low: 0, Fair: 1, Good: 2, "Very good": 3 };
  var LABEL = {
    NEED_LOCATION: "Need location",
    NOT_RATED: "Not rated"
  };

  var DEEP_SWE_MM = 25;
  var MELT_SWE_MM = 8;
  var LIGHT_SWE_MM = 8;
  var PERSISTENT_SWE_MM = 15;
  var WIND_EDGE = 8;
  var WIND_STRONG = 18;
  var WIND_INCREASE = 8;
  var PRECIP_ARRIVING_MM = 0.4;
  var DAYLIGHT_CLOSE_H = 2;
  var LATER_WARM_H = 6;

  var DISCLAIMER =
    "Today’s Hunt is an interpreted recommendation for going shed hunting today — " +
    "season and field conditions together, not a find probability, and never a claim " +
    "that sheds or deer are at a place.";

  var TODAY_LEAD = {
    "Very good": "Today looks worth searching.",
    Good: "Good day to search.",
    Fair: "Fair day for a shed hunt.",
    Low: "Today is a poor shed-hunt day."
  };

  function getTiming() { return global.WaypointShedsTiming || null; }
  function getSearchability() { return global.WaypointShedsSearchability || null; }
  function getWeather() { return global.WaypointShedsWeather || null; }

  function minBand(a, b) {
    if (RANK[a] == null) return b;
    if (RANK[b] == null) return a;
    return RANK[a] <= RANK[b] ? a : b;
  }

  function isFiniteCoord(n) {
    return typeof n === "number" && isFinite(n);
  }

  function locationKnown(loc) {
    return !!(loc && isFiniteCoord(loc.lat) && isFiniteCoord(loc.lng));
  }

  /**
   * Usable weather for a rating: live package with a numeric temperature.
   * Wind/daylight gaps are listed internally; they do not make missing data Low.
   */
  function weatherIsUsable(wx, weatherStatus) {
    return !!(wx && weatherStatus === "ready" && typeof wx.tempC === "number" && isFinite(wx.tempC));
  }

  function isRatedBand(band) {
    return RATED_BANDS.indexOf(band) >= 0;
  }

  function seasonPlain(timing) {
    if (!timing) return "Season timing unclear";
    return timing.plainLabel || timing.label || "Season timing unclear";
  }

  function seasonCategory(timing) {
    return (timing && timing.category) || "unknown";
  }

  /**
   * Searchability favorability is a condition input into the overall
   * recommendation — not mapped 1:1 onto hunt bands, and never a rating
   * when weather is missing.
   */
  function baseFromSearchability(favorability) {
    if (favorability === "favorable") return "Good";
    if (favorability === "moderate") return "Fair";
    if (favorability === "limited") return "Low";
    return "Fair";
  }

  function unknownTiming() {
    return {
      channel: "timing",
      category: "unknown",
      label: "Unknown",
      plainLabel: "Season timing unclear",
      phaseId: "unknown",
      phaseLabel: "Unknown",
      supportLine: "Season timing needs a location.",
      why: ["Latitude is required for the regional search window."],
      limitations: ["Does not predict exact cast dates."],
      season: null
    };
  }

  function strongestReason(parts) {
    for (var i = 0; i < parts.length; i++) {
      if (parts[i]) return parts[i];
    }
    return "";
  }

  function laterHoursMean(times, values, nowMs, hours) {
    if (!times || !values || times.length !== values.length) return null;
    var s = 0;
    var n = 0;
    var i;
    var until = nowMs + hours * 3600000;
    for (i = 0; i < times.length; i++) {
      var t = new Date(times[i]).getTime();
      if (!isFinite(t) || t < nowMs || t > until) continue;
      if (typeof values[i] !== "number" || !isFinite(values[i])) continue;
      s += values[i];
      n++;
    }
    if (!n) return null;
    return s / n;
  }

  function precipArriving(wx, nowMs, sunsetHour, nowHour) {
    if (!wx || !wx.hourlyTimes || !wx.hourlyPrecip) return false;
    var untilMs = nowMs + 18 * 3600000;
    if (typeof sunsetHour === "number" && typeof nowHour === "number" && sunsetHour > nowHour) {
      untilMs = nowMs + (sunsetHour - nowHour) * 3600000;
    }
    var i;
    for (i = 0; i < wx.hourlyTimes.length; i++) {
      var t = new Date(wx.hourlyTimes[i]).getTime();
      if (!isFinite(t) || t < nowMs || t > untilMs) continue;
      if (typeof wx.hourlyPrecip[i] === "number" && wx.hourlyPrecip[i] >= PRECIP_ARRIVING_MM) {
        return true;
      }
    }
    return false;
  }

  function composeWhere(opts) {
    var wx = opts.weather || {};
    var timing = opts.timing;
    var patterns = opts.patterns;
    var cat = seasonCategory(timing);
    var lines = [];

    if (patterns && patterns.sufficient && patterns.topHabitats && patterns.topHabitats[0]) {
      lines.push(
        "Your notes most often mention " + patterns.topHabitats[0].label +
          " — a type of ground from your records, not a find map."
      );
    }
    if (typeof wx.snowMm === "number" && wx.snowMm > MELT_SWE_MM &&
        typeof wx.tempC === "number" && wx.tempC > 0) {
      lines.push(
        "Exposed edges and south-facing ground often open first as snow recedes. " +
          "Confirm aspect on the map — this is a type of ground, not a claim about your current slope."
      );
    }
    if (typeof wx.windSpeedMs === "number" && wx.windSpeedMs >= WIND_EDGE) {
      lines.push(
        "Fence lines and lee edges can be worth checking if they exist in your Search Area."
      );
    }
    if (cat === "peak" || cat === "late" || cat === "mostly_past") {
      lines.push(
        "Winter-cover edges and travel benches are typical search types — use the map to compare them."
      );
    }
    if (!lines.length) {
      return {
        text: "Use the map to compare exposed and sheltered ground.",
        supported: false,
        ruleId: "where-map-compare"
      };
    }
    return {
      text: lines.slice(0, 2).join(" "),
      supported: true,
      ruleId: "where-supported-types"
    };
  }

  function composeWatch(opts) {
    var wx = opts.weather;
    var now = opts.now;
    if (!wx) return null;
    var nowMs = now.getTime();
    var nowHour = now.getHours() + now.getMinutes() / 60;
    var items = [];
    var Wx = getWeather();
    var laterTemp = laterHoursMean(wx.hourlyTimes, wx.hourlyTemps, nowMs, LATER_WARM_H);
    if (typeof wx.tempC === "number" && laterTemp != null &&
        laterTemp - wx.tempC >= (Wx ? Wx.TEMP_TREND_THRESHOLD_C : 2)) {
      items.push("Warming later today could change how the ground reads.");
    }
    if (precipArriving(wx, nowMs, wx.sunsetHour, nowHour) ||
        (typeof wx.precipNowMm === "number" && wx.precipNowMm >= PRECIP_ARRIVING_MM)) {
      items.push("Precipitation arriving — footing and visibility may shift.");
    }
    var laterWind = null;
    if (wx.hourlyTimes && wx.hourlyWinds) {
      laterWind = laterHoursMean(wx.hourlyTimes, wx.hourlyWinds, nowMs, LATER_WARM_H);
    }
    if (typeof wx.windSpeedMs === "number" && laterWind != null &&
        laterWind >= wx.windSpeedMs + WIND_INCREASE) {
      items.push("Wind increasing later — lee edges may matter more if they exist.");
    }
    if (wx.snowDepthKnown && wx.snowCover &&
        (wx.snowCover.status === "limiting" || wx.snowCover.status === "deep")) {
      items.push("Snow remains a limiting factor.");
    } else if (!wx.snowDepthKnown && typeof wx.snowMm === "number" && wx.snowMm >= PERSISTENT_SWE_MM &&
        !(typeof wx.tempC === "number" && wx.tempC > 0 && wx.snowMm > MELT_SWE_MM)) {
      items.push("Snow cover may still hide ground — snow-depth data is unavailable.");
    }
    if (typeof wx.sunsetHour === "number" &&
        wx.sunsetHour - nowHour < DAYLIGHT_CLOSE_H && wx.sunsetHour - nowHour > 0) {
      items.push("Daylight is closing.");
    }
    if (!items.length) return null;
    return items[0];
  }

  /**
   * Compose Today's Hunt.
   *
   * Rating eligibility (all required before Low/Fair/Good/Very good):
   *   1. Valid location (finite lat/lng from GPS, saved view, Search Area, or
   *      a zoomed map center — never an invented town).
   *   2. Usable weather: fetched package with a numeric temperature.
   *   3. Season/timing is derived from date + latitude. It is shown whenever
   *      a location exists. A missing timing module does not invent Low;
   *      season then reads unclear and Very good is blocked.
   *
   * Unrated:
   *   Need location — no valid place.
   *   Not rated — place known, weather/field conditions unavailable.
   *
   * Rated meaning — overall shed-hunt recommendation:
   *   Low  — enough data; seasonal opportunity and/or field conditions are poor.
   *   Fair — enough data; a cautious go (approaching/late leftover, or mixed
   *          conditions in an open window).
   *   Good — enough data; open seasonal window and workable-to-favorable field
   *          conditions.
   *   Very good — Good plus strong extras (see below). Never without location
   *          and usable weather.
   *
   * Season caps (after searchability suggests a base):
   *   outside      → Low (weather cannot raise the overall hunt rec)
   *   early        → max Fair (approaching)
   *   mostly_past  → max Fair (leftover)
   *   building/peak/late → weather may raise; Very good still needs extras
   *
   * Very good requires: usable weather, location, favorable field conditions,
   * season peak (or building/late with an extra melt/warming/freeze-thaw
   * signal), not continuously below freezing, not deep measured snow,
   * snowfall_sum not elevated unless measured depth is none/light,
   * and at least one extra (warming+snow, melt, freeze→thaw, or peak with
   * light cover).
   */
  function compose(opts) {
    opts = opts || {};
    var now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
    if (isNaN(now.getTime())) now = new Date();
    var loc = opts.location || null;
    var known = locationKnown(loc);
    var locSource = known ? (loc.source || "unknown") : "unknown";
    var wx = opts.weather && opts.weather.ready !== false ? opts.weather : null;
    var weatherStatus = opts.weatherStatus || (wx ? "ready" : "unavailable");
    var usableWx = weatherIsUsable(wx, weatherStatus);
    var ruleIds = [];
    var missingInputs = [];
    var why = [];

    if (!known) missingInputs.push("location");
    if (!usableWx) missingInputs.push("weather");
    if (usableWx) {
      if (typeof wx.windSpeedMs !== "number") missingInputs.push("wind");
      if (typeof wx.sunriseHour !== "number" || typeof wx.sunsetHour !== "number") {
        missingInputs.push("daylight");
      }
    }

    var Timing = getTiming();
    var timing = opts.timing || null;
    if (!timing) {
      if (Timing && known) {
        timing = Timing.evaluate({ date: now, lat: loc.lat, prefs: opts.prefs || {} });
      } else {
        timing = unknownTiming();
      }
    }

    var locationStatus = !known ? "unavailable"
      : locSource === "denied" ? "denied"
        : "ready";

    var Searchability = getSearchability();
    var searchability = opts.searchability || null;
    if (!searchability && Searchability && typeof Searchability.evaluate === "function") {
      searchability = Searchability.evaluate({
        weather: usableWx ? wx : null,
        weatherStatus: weatherStatus,
        locationStatus: locationStatus,
        season: timing && timing.season ? timing.season : timing,
        patterns: opts.patterns || null,
        plan: opts.plan || null,
        now: now
      });
    }

    var favorability = searchability && searchability.favorability
      ? searchability.favorability
      : "uncertain";
    var snow = Searchability && typeof Searchability.snowStatus === "function"
      ? Searchability.snowStatus(wx)
      : { known: false, depthKnown: false, label: "Snow-depth data is unavailable" };

    var WxMod = getWeather();
    var tempTrend = (wx && wx.tempTrend) || null;
    if (!tempTrend && wx && WxMod && wx.hourlyTimes && wx.hourlyTemps) {
      tempTrend = WxMod.deriveTempTrend(wx.hourlyTimes, wx.hourlyTemps, now);
    }
    if (!tempTrend) {
      tempTrend = {
        status: "unknown",
        label: "Temperature trend unknown",
        deltaC: null,
        detail: "Hourly temperatures were not available."
      };
    }
    if (tempTrend.status === "unknown" && usableWx) {
      missingInputs.push("temperature_trend");
    }

    var freezeThaw = (wx && wx.freezeThaw) || null;
    if (!freezeThaw && wx && WxMod && typeof WxMod.deriveFreezeThaw === "function") {
      freezeThaw = WxMod.deriveFreezeThaw({
        hourlyTimes: wx.hourlyTimes,
        hourlyTemps: wx.hourlyTemps,
        todayDateStr: WxMod.localDateString
          ? WxMod.localDateString(now, wx.utcOffsetMinutes != null ? wx.utcOffsetMinutes * 60 : null)
          : null,
        dailyMinC: wx.dailyMinC,
        dailyMaxC: wx.dailyMaxC,
        now: now
      });
    }
    if (!freezeThaw) {
      freezeThaw = {
        status: "insufficient",
        label: "Freeze/thaw unknown",
        detail: "Not enough temperature data to judge freeze or thaw."
      };
    }
    if (freezeThaw.status === "insufficient" && usableWx) {
      missingInputs.push("freeze_thaw");
    }

    var snowCover = (wx && wx.snowCover) || null;
    if (!snowCover && WxMod && typeof WxMod.classifySnowDepth === "function") {
      snowCover = WxMod.classifySnowDepth(wx && wx.snowDepthM, !!(wx && wx.snowDepthKnown));
    }
    if (!snowCover) {
      snowCover = {
        status: "unavailable",
        label: "Snow-depth data is unavailable",
        detail: "Snow-depth data is unavailable."
      };
    }

    var cat = seasonCategory(timing);
    var rating = null;
    var status = "ready";
    var todaySpecial = null;
    var whereObj = null;

    if (weatherStatus === "loading" && !wx) {
      status = "loading";
      ruleIds.push("loading");
      todaySpecial = "Reading today’s conditions…";
      why.push("Waiting on live weather.");
    } else if (!known) {
      status = "need_location";
      ruleIds.push("need-location");
      todaySpecial = "Share a location or choose an area to get today’s local hunt assessment.";
      why.push("Today’s Hunt needs a place to read season and weather. It does not invent a town.");
    } else if (!usableWx) {
      status = "not_rated";
      ruleIds.push("not-rated-weather");
      todaySpecial = "Today’s local conditions are temporarily unavailable.";
      why.push("Weather for this place could not be read, so today is not rated.");
      why.push(seasonPlain(timing) + " — regional timing, not a same-day cast.");
    } else {
      rating = baseFromSearchability(favorability);
      ruleIds.push("base-field-" + favorability);

      var depthKnownNoneOrLight = wx.snowDepthKnown === true &&
        (snowCover.status === "none" || snowCover.status === "light");

      if (snowCover.status === "deep") {
        rating = minBand(rating, "Fair");
        ruleIds.push("cap-deep-snow-depth");
        why.push("Snow remains a limiting factor.");
      } else if (typeof wx.snowMm === "number" && wx.snowMm > DEEP_SWE_MM && !depthKnownNoneOrLight) {
        rating = minBand(rating, "Fair");
        ruleIds.push("cap-deep-swe");
        if (wx.snowDepthKnown) {
          why.push("Recent snowfall is elevated — measured snow cover may still hide ground, so opportunity stays cautious.");
        } else {
          why.push("Recent snowfall is elevated — measured ground depth is unavailable, so opportunity stays cautious.");
        }
      }

      if (cat === "outside") {
        rating = "Low";
        ruleIds.push("season-outside-low");
      } else if (cat === "early" || cat === "mostly_past") {
        rating = minBand(rating, "Fair");
        ruleIds.push("cap-season-" + cat);
      }

      var extra = false;
      if (tempTrend.status === "warming" && typeof wx.snowMm === "number" && wx.snowMm > 0.5) {
        extra = true;
        ruleIds.push("extra-warming-snow");
      }
      if (typeof wx.snowMm === "number" && wx.snowMm > MELT_SWE_MM &&
          typeof wx.tempC === "number" && wx.tempC > 0) {
        extra = true;
        ruleIds.push("extra-melt");
      }
      if (freezeThaw.status === "freeze_thaw") {
        extra = true;
        ruleIds.push("extra-freeze-thaw");
      }
      if (cat === "peak" && typeof wx.snowMm === "number" && wx.snowMm < LIGHT_SWE_MM &&
          (typeof wx.windSpeedMs !== "number" || wx.windSpeedMs < WIND_STRONG) &&
          snowCover.status !== "deep" && snowCover.status !== "limiting") {
        extra = true;
        ruleIds.push("extra-peak-light-cover");
      }

      var blockedBelow = freezeThaw.status === "below_freezing";
      var blockedDeep = snowCover.status === "deep";
      var canVeryGood = usableWx && known &&
        favorability === "favorable" &&
        (cat === "peak" || (cat === "building" && extra) || (cat === "late" && extra)) &&
        !(typeof wx.snowMm === "number" && wx.snowMm > DEEP_SWE_MM && !depthKnownNoneOrLight) &&
        !blockedBelow &&
        !blockedDeep &&
        extra;

      if (canVeryGood) {
        rating = "Very good";
        ruleIds.push("very-good");
      } else {
        ruleIds.push("very-good-blocked");
        if (blockedBelow) ruleIds.push("very-good-blocked-below-freezing");
        if (blockedDeep) ruleIds.push("very-good-blocked-deep-snow");
      }

      if (cat === "outside") {
        why.push("This is outside the main shed-search window for this latitude — not a day-by-day drop claim.");
        if (favorability === "favorable" || favorability === "moderate") {
          why.push("Walking weather is workable, but that does not raise today’s shed-hunt recommendation.");
        } else if (favorability === "limited") {
          why.push("Field conditions are limited as well.");
        }
      } else {
        if (freezeThaw.status === "freeze_thaw") {
          why.push("Overnight freeze followed by afternoon thaw may help expose searchable ground.");
        } else if (freezeThaw.status === "below_freezing") {
          why.push("Conditions remain below freezing, so snow and frozen ground may persist.");
        } else if (tempTrend.status === "warming") {
          why.push("Temperatures have been warming, which may improve ground exposure.");
        } else if (tempTrend.status === "cooling") {
          why.push("Recent cooling versus yesterday — freeze-adjacent air can change how ground reads.");
        }
        if (favorability === "favorable") {
          why.push("Weather and daylight look favorable for going out — opportunity, not a find chance.");
        } else if (favorability === "moderate") {
          why.push("Field conditions are workable, not outstanding.");
        } else if (favorability === "limited") {
          why.push("Field conditions are limited today.");
        }
        why.push(seasonPlain(timing) + " — regional timing, not proof that casting happened here.");
      }
      if (!wx.snowDepthKnown && typeof wx.snowMm === "number" && wx.snowMm > 0.5 && why.length < 3) {
        why.push("Recent snowfall is noted; snow-depth data is unavailable.");
      }

      whereObj = composeWhere({ weather: wx, timing: timing, patterns: opts.patterns });
    }

    if (status === "need_location") {
      whereObj = null;
    } else if (!whereObj) {
      whereObj = {
        text: "Use the map to compare exposed and sheltered ground.",
        supported: false
      };
    }

    var watch = (status === "ready" && usableWx) ? composeWatch({ weather: wx, now: now }) : null;

    var rated = isRatedBand(rating);
    var band = status === "loading" ? "…"
      : status === "need_location" ? LABEL.NEED_LOCATION
        : status === "not_rated" ? LABEL.NOT_RATED
          : rating;

    var supportLevel = "limited";
    if (rated && missingInputs.filter(function (id) {
      return id !== "temperature_trend" && id !== "freeze_thaw";
    }).length === 0) {
      supportLevel = "strong";
    } else if (usableWx || known) {
      supportLevel = "partial";
    }

    var conditions = [];
    if (rated) {
      if (freezeThaw.status === "freeze_thaw") {
        conditions.push("Overnight freeze followed by afternoon thaw may help expose searchable ground.");
      } else if (freezeThaw.status === "below_freezing") {
        conditions.push("Conditions remain below freezing, so snow and frozen ground may persist.");
      } else if (freezeThaw.status === "above_freezing") {
        conditions.push("Air stayed above freezing.");
      } else if (freezeThaw.status === "near_freezing") {
        conditions.push("Temperatures stayed near freezing — a freeze/thaw cycle is not claimed.");
      }
      if (tempTrend.status === "warming") {
        conditions.push("Temperatures have been warming, which may improve ground exposure.");
      } else if (tempTrend.status === "cooling") {
        conditions.push("Temperatures have been cooling.");
      } else if (tempTrend.status === "little_change") {
        conditions.push("Temperatures have been relatively stable.");
      }
      if (snowCover.status === "unavailable") {
        conditions.push("Snow-depth data is unavailable.");
      } else if (snowCover.status === "none") {
        conditions.push("No snow on the ground (measured).");
      } else if (snowCover.status === "light") {
        conditions.push("Light snow cover.");
      } else if (snowCover.status === "limiting" || snowCover.status === "deep") {
        conditions.push("Snow remains a limiting factor.");
      }
      conditions = conditions.slice(0, 3);
    }

    var strongest = strongestReason(why);
    var today = todaySpecial;
    if (!today && rated) {
      today = TODAY_LEAD[rating] + (strongest ? " " + strongest : "");
      why = why.filter(function (line) { return line !== strongest; });
    }
    why = why.slice(0, 3);
    if (today && conditions.length) {
      conditions = conditions.filter(function (line) {
        return today.indexOf(line) < 0;
      });
    }

    var locLine = !known
      ? null
      : locSource === "gps"
        ? "Using current location."
        : locSource === "saved-view"
          ? "Using your last map view."
          : locSource === "saved-area"
            ? "Using a saved Search Area."
            : locSource === "map-center"
              ? "Using the map center you are looking at."
              : "Using a saved place on this device.";

    return {
      status: status,
      rated: rated,
      rating: rated ? rating : null,
      band: band,
      today: today,
      why: why,
      conditions: conditions,
      where: whereObj && status !== "need_location" ? whereObj.text : null,
      whereSupported: !!(whereObj && whereObj.supported),
      watch: watch,
      season: {
        label: seasonPlain(timing),
        category: cat,
        supportLine: timing && timing.supportLine ? timing.supportLine : ""
      },
      support: {
        level: supportLevel,
        missingInputs: missingInputs.slice(),
        locationSource: locSource,
        locationLine: locLine,
        weatherStatus: weatherStatus
      },
      disclaimer: DISCLAIMER,
      channels: {
        timing: timing,
        searchability: searchability
          ? {
              favorability: searchability.favorability,
              status: searchability.status,
              headline: searchability.headline,
              snow: snow
            }
          : null,
        tempTrend: tempTrend,
        freezeThaw: freezeThaw,
        snow: snow,
        snowCover: snowCover
      },
      ruleIds: ruleIds,
      bestWindow: searchability && searchability.brief && searchability.brief.timeWindows
        ? searchability.brief.timeWindows[0]
        : (searchability && searchability.timeWindows ? searchability.timeWindows[0] : null)
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderHuntHtml(hunt, view) {
    view = view || {};
    if (!hunt) return "";
    var band = hunt.band || LABEL.NOT_RATED;
    var html = '<article class="sheds-hunt" data-band="' + escapeHtml(band) + '"' +
      ' data-rated="' + (hunt.rated ? "true" : "false") + '"' +
      (hunt.status ? ' data-status="' + escapeHtml(hunt.status) + '"' : "") + ">";
    if (view.includeQuestion !== false) {
      html += '<p class="sheds-hunt__question">Should I go shed hunting today?</p>';
    }
    html += '<p class="sheds-hunt__band"><span class="sheds-hunt__band-label">' +
      escapeHtml(band) + "</span></p>";
    html += '<p class="sheds-hunt__today">' + escapeHtml(hunt.today) + "</p>";
    html += '<p class="sheds-hunt__season">Season: ' + escapeHtml(hunt.season && hunt.season.label) + "</p>";
    if (hunt.conditions && hunt.conditions.length) {
      html += '<section class="sheds-hunt__block sheds-hunt__block--conditions" aria-label="Supporting conditions"><ul class="sheds-hunt__conditions">';
      hunt.conditions.forEach(function (line) {
        html += "<li>" + escapeHtml(line) + "</li>";
      });
      html += "</ul></section>";
    }
    if (view.openMapHref && hunt.status !== "need_location" && hunt.status !== "loading") {
      html += '<p class="sheds-hunt__cta"><a class="sheds-host-btn" href="' +
        escapeHtml(view.openMapHref) + '">Open Map</a></p>';
    }
    if (hunt.why && hunt.why.length) {
      html += '<section class="sheds-hunt__block"><h3 class="sheds-hunt__k">Why</h3><ul class="sheds-hunt__why">';
      hunt.why.forEach(function (line) {
        html += "<li>" + escapeHtml(line) + "</li>";
      });
      html += "</ul></section>";
    }
    if (hunt.where) {
      html += '<section class="sheds-hunt__block"><h3 class="sheds-hunt__k">Where</h3><p>' +
        escapeHtml(hunt.where) + "</p></section>";
    }
    if (hunt.watch) {
      html += '<section class="sheds-hunt__block"><h3 class="sheds-hunt__k">Watch</h3><p>' +
        escapeHtml(hunt.watch) + "</p></section>";
    }
    if (hunt.rated && hunt.support && hunt.support.locationLine) {
      html += '<p class="sheds-hunt__support">' + escapeHtml(hunt.support.locationLine) + "</p>";
    } else if (hunt.status === "not_rated" && hunt.support && hunt.support.locationLine) {
      html += '<p class="sheds-hunt__support">' + escapeHtml(hunt.support.locationLine) + "</p>";
    }
    html += '<p class="sheds-hunt__disclaimer">' + escapeHtml(hunt.disclaimer) + "</p>";
    html += "</article>";
    return html;
  }

  function fillHuntRoot(el, hunt, view) {
    if (!el) return;
    el.innerHTML = renderHuntHtml(hunt, view);
  }

  global.WaypointShedsTodayHunt = {
    BANDS: RATED_BANDS,
    RATED_BANDS: RATED_BANDS,
    LABEL: LABEL,
    DEEP_SWE_MM: DEEP_SWE_MM,
    MELT_SWE_MM: MELT_SWE_MM,
    DISCLAIMER: DISCLAIMER,
    weatherIsUsable: weatherIsUsable,
    isRatedBand: isRatedBand,
    compose: compose,
    renderHuntHtml: renderHuntHtml,
    fillHuntRoot: fillHuntRoot
  };
})(typeof window !== "undefined" ? window : globalThis);
