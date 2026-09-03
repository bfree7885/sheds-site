/**
 * Sheds — shared Open-Meteo forecast parse for map + dedicated-host overview.
 *
 * RAW (Open-Meteo v1/forecast, verified 2026-08-31):
 *   current/hourly temperature_2m        °C
 *   daily temperature_2m_min / _max       °C  (local-day aggregation)
 *   hourly + current snow_depth           meters on the ground
 *   daily snowfall_sum                  cm of snowfall (NOT depth, NOT SWE)
 *
 * Open-Meteo documents SWE only as snowfall_cm / 7. This module never
 * converts snowfall_sum into depth, and never treats missing snow_depth as 0.
 *
 * DERIVED: freeze/thaw, 24–48 h temperature trend, snow-cover class.
 */
(function (global) {
  "use strict";

  /** °C. Differences below this are Relatively stable — do not overstate noise. */
  var TEMP_TREND_THRESHOLD_C = 2.0;
  var TREND_HOURS = 6;
  var TREND_LOOKBACK_H = 24;
  var TREND_LOOKBACK_H_LONG = 48;
  var MIN_HOURLY_SAMPLES = 12;
  var MIN_SPAN_HOURS = 12;

  /**
   * Must reach ≤ −1 °C to count as a freeze and ≥ +1 °C to count as a thaw.
   * Open-Meteo temperatures are typically 0.1 °C; 1 °C is a small deadband
   * that ignores tiny wiggles around 0 °C.
   */
  var FREEZE_DEADBAND_C = 1.0;
  var OVERNIGHT_START_H = 18;
  var OVERNIGHT_END_H = 8;
  var DAYTIME_START_H = 10;
  var DAYTIME_END_H = 16;
  var MIN_NIGHT_SAMPLES = 4;
  var MIN_DAY_SAMPLES = 3;

  /** Snow depth classes (meters). Do not show raw meter precision in UI. */
  var SNOW_LIGHT_M = 0.05;
  var SNOW_LIMITING_M = 0.15;
  var SNOW_NEAR_HOURS = 3;

  /** Must match FORECAST_QUERY. Extra past days are for hourly trend/freeze only. */
  var PAST_DAYS = 2;

  var FORECAST_QUERY =
    "current=temperature_2m,wind_speed_10m,surface_pressure,precipitation,snow_depth" +
    "&hourly=temperature_2m,wind_speed_10m,precipitation,surface_pressure,snow_depth" +
    "&daily=snowfall_sum,sunrise,sunset,precipitation_sum,temperature_2m_min,temperature_2m_max" +
    "&timezone=auto&forecast_days=3&past_days=2";

  function forecastUrl(lat, lng) {
    return "https://api.open-meteo.com/v1/forecast?latitude=" + Number(lat).toFixed(4) +
      "&longitude=" + Number(lng).toFixed(4) +
      "&" + FORECAST_QUERY;
  }

  function finiteNum(n) {
    return typeof n === "number" && isFinite(n);
  }

  function formatLocalClock(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    try {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
    }
  }

  function hourFromIso(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.getHours() + d.getMinutes() / 60;
  }

  /** Civil hour from Open-Meteo local ISO (`2026-02-15T03:00`) or UTC ISO. */
  function civilHourFromIso(iso) {
    if (!iso) return null;
    var m = /T(\d{2})/.exec(String(iso));
    if (!m) {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      return d.getHours();
    }
    return Number(m[1]);
  }

  function isoDatePrefix(iso) {
    if (!iso) return null;
    var s = String(iso);
    return s.length >= 10 ? s.slice(0, 10) : null;
  }

  function localDateString(now, utcOffsetSeconds) {
    var d = now instanceof Date ? now : new Date(now);
    if (isNaN(d.getTime())) return null;
    if (typeof utcOffsetSeconds === "number" && isFinite(utcOffsetSeconds)) {
      return new Date(d.getTime() + utcOffsetSeconds * 1000).toISOString().slice(0, 10);
    }
    var y = d.getFullYear();
    var mo = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + mo + "-" + day;
  }

  function previousDateStr(ymd) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    var p = ymd.split("-");
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Local-today index in an Open-Meteo daily series.
   * past_days prepends older days; a date miss falls back to PAST_DAYS.
   */
  function todayDailyIndex(dailyTime, todayStr, length) {
    if (dailyTime && dailyTime.length && todayStr) {
      var found = dailyTime.indexOf(todayStr);
      if (found >= 0) return found;
    }
    var n = dailyTime && dailyTime.length ? dailyTime.length : (length || 0);
    if (n > PAST_DAYS) return PAST_DAYS;
    if (n > 1) return 1;
    return 0;
  }

  function meanRange(arr, from, to) {
    var n = 0;
    var s = 0;
    var i;
    for (i = from; i <= to; i++) {
      if (finiteNum(arr[i])) {
        s += arr[i];
        n++;
      }
    }
    return n ? s / n : null;
  }

  function findIdxNear(times, targetMs, maxGapMs) {
    var best = Infinity;
    var idx = -1;
    var i;
    for (i = 0; i < times.length; i++) {
      var gap = Math.abs(times[i] - targetMs);
      if (gap < best && gap <= maxGapMs) {
        best = gap;
        idx = i;
      }
    }
    return idx;
  }

  function unknownTrend(samples, detail) {
    return {
      status: "unknown",
      label: "Temperature trend unknown",
      deltaC: null,
      thresholdC: TEMP_TREND_THRESHOLD_C,
      samplesUsed: samples || 0,
      lookbackHours: null,
      detail: detail || "Not enough hourly temperatures to judge a recent trend."
    };
  }

  /**
   * Recent temperature trend from hourly 2m temperatures.
   *
   * Prefer a ~48 h lookback when that window exists; otherwise the V1.1
   * ~24 h lookback. Compare the mean of the last TREND_HOURS hours to the
   * same-length window at the lookback. Threshold: 2.0 °C.
   *
   * @returns {{
   *   status: 'warming'|'cooling'|'little_change'|'unknown',
   *   label: string,
   *   deltaC: number|null,
   *   thresholdC: number,
   *   samplesUsed: number,
   *   lookbackHours: number|null,
   *   detail: string
   * }}
   */
  function deriveTempTrend(hourlyTimes, hourlyTemps, now) {
    if (!hourlyTimes || !hourlyTemps || hourlyTimes.length !== hourlyTemps.length) {
      return unknownTrend(0);
    }
    var nowMs = (now instanceof Date ? now : new Date(now)).getTime();
    if (!isFinite(nowMs)) return unknownTrend(0);

    var times = [];
    var temps = [];
    var i;
    for (i = 0; i < hourlyTimes.length; i++) {
      var t = new Date(hourlyTimes[i]).getTime();
      if (!isFinite(t)) continue;
      if (!finiteNum(hourlyTemps[i])) continue;
      times.push(t);
      temps.push(hourlyTemps[i]);
    }
    if (temps.length < MIN_HOURLY_SAMPLES) return unknownTrend(temps.length);
    var spanH = (times[times.length - 1] - times[0]) / 3600000;
    if (spanH < MIN_SPAN_HOURS) return unknownTrend(temps.length);

    var nowIdx = -1;
    var best = Infinity;
    for (i = 0; i < times.length; i++) {
      if (times[i] > nowMs + 30 * 60000) continue;
      var d = Math.abs(times[i] - nowMs);
      if (d < best) {
        best = d;
        nowIdx = i;
      }
    }
    if (nowIdx < 0) return unknownTrend(temps.length);

    var lookbacks = [TREND_LOOKBACK_H_LONG, TREND_LOOKBACK_H];
    var used = null;
    var recent = null;
    var past = null;
    var lookbackIdx = -1;
    for (i = 0; i < lookbacks.length; i++) {
      var hours = lookbacks[i];
      var idx = findIdxNear(times, times[nowIdx] - hours * 3600000, 2.5 * 3600000);
      if (idx < 0 || times[idx] >= times[nowIdx]) continue;
      var recentFrom = Math.max(0, nowIdx - (TREND_HOURS - 1));
      var pastFrom = Math.max(0, idx - (TREND_HOURS - 1));
      var r = meanRange(temps, recentFrom, nowIdx);
      var p = meanRange(temps, pastFrom, idx);
      if (r == null || p == null) continue;
      used = hours;
      recent = r;
      past = p;
      lookbackIdx = idx;
      break;
    }
    if (used == null) {
      return unknownTrend(
        temps.length,
        "Hourly temperatures do not span a full day, so a day-to-day trend is not claimed."
      );
    }

    var delta = recent - past;
    var rounded = Math.round(delta * 10) / 10;
    var status;
    var label;
    if (delta >= TEMP_TREND_THRESHOLD_C) {
      status = "warming";
      label = "Warming";
    } else if (delta <= -TEMP_TREND_THRESHOLD_C) {
      status = "cooling";
      label = "Cooling";
    } else {
      status = "little_change";
      label = "Relatively stable";
    }
    var recentFromOut = Math.max(0, nowIdx - (TREND_HOURS - 1));
    var pastFromOut = Math.max(0, lookbackIdx - (TREND_HOURS - 1));
    return {
      status: status,
      label: label,
      deltaC: rounded,
      thresholdC: TEMP_TREND_THRESHOLD_C,
      samplesUsed: (nowIdx - recentFromOut + 1) + (lookbackIdx - pastFromOut + 1),
      lookbackHours: used,
      detail: status === "little_change"
        ? ("About " + (rounded >= 0 ? "+" : "") + rounded + " °C vs ~" + used +
          " hours earlier — below the " + TEMP_TREND_THRESHOLD_C +
          " °C threshold, so this is relatively stable.")
        : (label + " about " + (rounded >= 0 ? "+" : "") + rounded +
          " °C versus ~" + used + " hours earlier (threshold " +
          TEMP_TREND_THRESHOLD_C + " °C).")
    };
  }

  function nightDayTemps(hourlyTimes, hourlyTemps, todayStr) {
    var empty = { nightMin: null, dayMax: null, nightSamples: 0, daySamples: 0 };
    if (!todayStr || !hourlyTimes || !hourlyTemps) return empty;
    var yesterday = previousDateStr(todayStr);
    var nightMin = null;
    var dayMax = null;
    var nightN = 0;
    var dayN = 0;
    var i;
    for (i = 0; i < hourlyTimes.length; i++) {
      if (!finiteNum(hourlyTemps[i])) continue;
      var dateStr = isoDatePrefix(hourlyTimes[i]);
      var hour = civilHourFromIso(hourlyTimes[i]);
      if (dateStr == null || hour == null) continue;
      var overnight = (yesterday && dateStr === yesterday && hour >= OVERNIGHT_START_H) ||
        (dateStr === todayStr && hour < OVERNIGHT_END_H);
      var daytime = dateStr === todayStr && hour >= DAYTIME_START_H && hour <= DAYTIME_END_H;
      if (overnight) {
        nightN++;
        if (nightMin == null || hourlyTemps[i] < nightMin) nightMin = hourlyTemps[i];
      }
      if (daytime) {
        dayN++;
        if (dayMax == null || hourlyTemps[i] > dayMax) dayMax = hourlyTemps[i];
      }
    }
    return { nightMin: nightMin, dayMax: dayMax, nightSamples: nightN, daySamples: dayN };
  }

  function unknownFreeze(detail) {
    return {
      status: "insufficient",
      label: "Freeze/thaw unknown",
      detail: detail || "Not enough temperature data to judge freeze or thaw.",
      nightMinC: null,
      dayMaxC: null,
      deadbandC: FREEZE_DEADBAND_C,
      source: null
    };
  }

  /**
   * Conservative freeze/thaw from overnight min + daytime max.
   *
   * Status:
   *   freeze_thaw      overnight ≤ −1 °C and daytime ≥ +1 °C
   *   below_freezing   daytime max ≤ −1 °C
   *   above_freezing   overnight min ≥ +1 °C
   *   near_freezing    data exists but the swing is inside the deadband
   *   insufficient     missing daily min/max and not enough hourly samples
   */
  function deriveFreezeThaw(opts) {
    opts = opts || {};
    var hourly = nightDayTemps(opts.hourlyTimes, opts.hourlyTemps, opts.todayDateStr);
    var nightMin = null;
    var dayMax = null;
    var source = null;
    if (hourly.nightSamples >= MIN_NIGHT_SAMPLES && hourly.daySamples >= MIN_DAY_SAMPLES &&
        finiteNum(hourly.nightMin) && finiteNum(hourly.dayMax)) {
      nightMin = hourly.nightMin;
      dayMax = hourly.dayMax;
      source = "hourly";
    } else if (finiteNum(opts.dailyMinC) && finiteNum(opts.dailyMaxC)) {
      nightMin = opts.dailyMinC;
      dayMax = opts.dailyMaxC;
      source = "daily";
    } else {
      return unknownFreeze();
    }

    var freeze = nightMin <= -FREEZE_DEADBAND_C;
    var thaw = dayMax >= FREEZE_DEADBAND_C;
    var allBelow = dayMax <= -FREEZE_DEADBAND_C;
    var allAbove = nightMin >= FREEZE_DEADBAND_C;
    var status;
    var label;
    var detail;
    if (freeze && thaw) {
      status = "freeze_thaw";
      label = "Overnight freeze then thaw";
      detail = "Overnight air fell to a meaningful freeze, then daytime rose above freezing. " +
        "That may help expose searchable ground — it does not mean sheds dropped or will be found.";
    } else if (allBelow) {
      status = "below_freezing";
      label = "Staying below freezing";
      detail = "Conditions remain below freezing, so snow and frozen ground may persist.";
    } else if (allAbove) {
      status = "above_freezing";
      label = "Staying above freezing";
      detail = "Air stayed above freezing across the overnight and daytime windows.";
    } else {
      status = "near_freezing";
      label = "Near freezing";
      detail = "Temperatures stayed close to 0 °C, so a freeze/thaw cycle is not claimed.";
    }
    return {
      status: status,
      label: label,
      detail: detail,
      nightMinC: Math.round(nightMin * 10) / 10,
      dayMaxC: Math.round(dayMax * 10) / 10,
      deadbandC: FREEZE_DEADBAND_C,
      source: source
    };
  }

  /**
   * Pick a usable snow_depth (meters). Explicit 0 is known. Null/absent is not.
   */
  function pickSnowDepth(current, hourlyTimes, hourlyDepth, now) {
    var unknown = { known: false, meters: null, source: null };
    if (current && finiteNum(current.snow_depth)) {
      return { known: true, meters: current.snow_depth, source: "current" };
    }
    if (!hourlyTimes || !hourlyDepth || hourlyTimes.length !== hourlyDepth.length) {
      return unknown;
    }
    var nowMs = (now instanceof Date ? now : new Date(now)).getTime();
    if (!isFinite(nowMs)) return unknown;
    var bestI = -1;
    var best = Infinity;
    var i;
    for (i = 0; i < hourlyTimes.length; i++) {
      if (!finiteNum(hourlyDepth[i])) continue;
      var t = new Date(hourlyTimes[i]).getTime();
      if (!isFinite(t)) continue;
      var gap = Math.abs(t - nowMs);
      if (gap < best && gap <= SNOW_NEAR_HOURS * 3600000) {
        best = gap;
        bestI = i;
      }
    }
    if (bestI < 0) return unknown;
    return { known: true, meters: hourlyDepth[bestI], source: "hourly" };
  }

  function classifySnowDepth(meters, known) {
    if (!known || !finiteNum(meters)) {
      return {
        status: "unavailable",
        label: "Snow-depth data is unavailable",
        detail: "Snow-depth data is unavailable. Missing depth is not clear ground, and snowfall/SWE is not used as depth.",
        depthM: null
      };
    }
    if (meters <= 0) {
      return {
        status: "none",
        label: "No snow on the ground",
        detail: "Measured snow depth is zero. That is not inferred from missing data.",
        depthM: 0
      };
    }
    if (meters < SNOW_LIGHT_M) {
      return {
        status: "light",
        label: "Light snow cover",
        detail: "A light measured snow cover — searchability may still be workable.",
        depthM: meters
      };
    }
    if (meters < SNOW_LIMITING_M) {
      return {
        status: "limiting",
        label: "Snow remains a limiting factor",
        detail: "Measured snow cover may hide ground. This is not a claim that sheds are under it.",
        depthM: meters
      };
    }
    return {
      status: "deep",
      label: "Snow remains a limiting factor",
      detail: "Deeper measured snow cover is likely to hide ground. This is not a find prediction.",
      depthM: meters
    };
  }

  function emptyPackage(reason) {
    return {
      ready: false,
      reason: reason || "empty",
      snowDepthKnown: false,
      snowDepthM: null,
      snowCover: classifySnowDepth(null, false),
      freezeThaw: unknownFreeze(),
      tempTrend: unknownTrend(0)
    };
  }

  /**
   * Parse Open-Meteo JSON into the weather package used by Today's Hunt.
   * snowMm is recent snowfall_sum from yesterday through the short forecast
   * (Open-Meteo unit: cm). It is never depth. The extra past_days=2 day is
   * omitted — that history is only for hourly freeze/thaw and the 48 h trend.
   */
  function parseForecast(json, now) {
    if (!json || !json.current) {
      return emptyPackage("empty");
    }
    var data = json;
    var nowDate = now instanceof Date ? now : (now ? new Date(now) : new Date());
    var offsetSec = typeof data.utc_offset_seconds === "number" ? data.utc_offset_seconds : null;
    var todayStr = localDateString(nowDate, offsetSec);
    var yestStr = previousDateStr(todayStr);
    var snow = 0;
    var snowfallKnown = false;
    if (data.daily && data.daily.snowfall_sum && data.daily.snowfall_sum.length) {
      snowfallKnown = true;
      var snowArr = data.daily.snowfall_sum;
      var snowTimes = data.daily.time;
      var si;
      for (si = 0; si < snowArr.length; si++) {
        if (snowTimes && snowTimes[si] && yestStr && snowTimes[si] < yestStr) continue;
        if (finiteNum(snowArr[si])) snow += snowArr[si];
      }
    }
    var influence = 1;
    if (snow > 25) influence = 0.7;
    else if (snow > 8) influence = 0.88;
    else if (snow > 0.5) influence = 1.05;

    var tempC = data.current && finiteNum(data.current.temperature_2m)
      ? data.current.temperature_2m : null;
    var windSpeedMs = data.current && finiteNum(data.current.wind_speed_10m)
      ? data.current.wind_speed_10m : null;
    var pressureHpa = data.current && finiteNum(data.current.surface_pressure)
      ? data.current.surface_pressure : null;
    var precipNowMm = data.current && finiteNum(data.current.precipitation)
      ? data.current.precipitation : null;

    var precipMm24h = null;
    if (data.daily && data.daily.precipitation_sum && data.daily.precipitation_sum.length) {
      var sums = data.daily.precipitation_sum;
      var precipIx = todayDailyIndex(data.daily.time, todayStr, sums.length);
      precipMm24h = Number(sums[precipIx] || 0);
      if (precipIx > 0) precipMm24h += Number(sums[precipIx - 1] || 0);
    }

    var pressureTrend = null;
    if (data.hourly && data.hourly.surface_pressure && data.hourly.surface_pressure.length >= 6) {
      var arr = data.hourly.surface_pressure.filter(function (v) { return finiteNum(v); });
      if (arr.length >= 6) {
        var early = arr[Math.max(0, arr.length - 12)];
        var late = arr[arr.length - 1];
        var delta = late - early;
        if (delta <= -1.5) pressureTrend = "falling";
        else if (delta >= 1.5) pressureTrend = "rising";
        else pressureTrend = "steady";
      }
    }

    var sunriseIso = null;
    var sunsetIso = null;
    var dailyMinC = null;
    var dailyMaxC = null;
    var dailyIdx = -1;
    if (data.daily) {
      var dailyLen = (data.daily.time && data.daily.time.length) ||
        (data.daily.sunrise && data.daily.sunrise.length) || 0;
      var ix = todayDailyIndex(data.daily.time, todayStr, dailyLen);
      if (data.daily.time && data.daily.time.length) dailyIdx = ix;
      sunriseIso = data.daily.sunrise && data.daily.sunrise[ix];
      sunsetIso = data.daily.sunset && data.daily.sunset[ix];
      if (data.daily.temperature_2m_min && finiteNum(data.daily.temperature_2m_min[ix])) {
        dailyMinC = data.daily.temperature_2m_min[ix];
      }
      if (data.daily.temperature_2m_max && finiteNum(data.daily.temperature_2m_max[ix])) {
        dailyMaxC = data.daily.temperature_2m_max[ix];
      }
    }

    var hourlyTimes = data.hourly && data.hourly.time ? data.hourly.time : [];
    var hourlyTemps = data.hourly && data.hourly.temperature_2m ? data.hourly.temperature_2m : [];
    var hourlyPrecip = data.hourly && data.hourly.precipitation ? data.hourly.precipitation : [];
    var hourlyWinds = data.hourly && data.hourly.wind_speed_10m ? data.hourly.wind_speed_10m : [];
    var hourlySnowDepth = data.hourly && data.hourly.snow_depth ? data.hourly.snow_depth : [];
    var tempTrend = deriveTempTrend(hourlyTimes, hourlyTemps, nowDate);
    var freezeThaw = deriveFreezeThaw({
      hourlyTimes: hourlyTimes,
      hourlyTemps: hourlyTemps,
      todayDateStr: todayStr,
      dailyMinC: dailyMinC,
      dailyMaxC: dailyMaxC,
      now: nowDate
    });
    var picked = pickSnowDepth(data.current, hourlyTimes, hourlySnowDepth, nowDate);
    var snowCover = classifySnowDepth(picked.meters, picked.known);

    var snowfallUnit = (data.daily_units && data.daily_units.snowfall_sum) || "cm";

    return {
      ready: true,
      snowInfluence: influence,
      snowMm: snow,
      snowfallSumCm: snowfallKnown ? snow : null,
      snowfallKnown: snowfallKnown,
      snowfallUnit: snowfallUnit,
      snowDepthKnown: picked.known,
      snowDepthM: picked.known ? picked.meters : null,
      snowDepthSource: picked.source,
      snowCover: snowCover,
      freezeThaw: freezeThaw,
      dailyMinC: dailyMinC,
      dailyMaxC: dailyMaxC,
      dailyIdx: dailyIdx,
      tempC: tempC,
      windSpeedMs: windSpeedMs,
      pressureHpa: pressureHpa,
      pressureTrend: pressureTrend,
      precipMm24h: precipMm24h,
      precipNowMm: precipNowMm,
      sunriseIso: sunriseIso || null,
      sunsetIso: sunsetIso || null,
      sunriseLocal: formatLocalClock(sunriseIso),
      sunsetLocal: formatLocalClock(sunsetIso),
      sunriseHour: hourFromIso(sunriseIso),
      sunsetHour: hourFromIso(sunsetIso),
      utcOffsetMinutes: typeof data.utc_offset_seconds === "number"
        ? data.utc_offset_seconds / 60 : null,
      hourlyTimes: hourlyTimes,
      hourlyTemps: hourlyTemps,
      hourlyPrecip: hourlyPrecip,
      hourlyWinds: hourlyWinds,
      hourlySnowDepth: hourlySnowDepth,
      tempTrend: tempTrend,
      source: "open-meteo",
      fetchedAt: nowDate.toISOString()
    };
  }

  function fetchForecast(lat, lng, now) {
    if (!isFinite(lat) || !isFinite(lng)) {
      return Promise.resolve(emptyPackage("no-location"));
    }
    var url = forecastUrl(lat, lng);
    return fetch(url, { credentials: "omit" }).then(function (res) {
      if (!res.ok) throw new Error("wx");
      return res.json();
    }).then(function (data) {
      return parseForecast(data, now || new Date());
    });
  }

  global.WaypointShedsWeather = {
    TEMP_TREND_THRESHOLD_C: TEMP_TREND_THRESHOLD_C,
    TREND_HOURS: TREND_HOURS,
    TREND_LOOKBACK_H: TREND_LOOKBACK_H,
    TREND_LOOKBACK_H_LONG: TREND_LOOKBACK_H_LONG,
    MIN_HOURLY_SAMPLES: MIN_HOURLY_SAMPLES,
    FREEZE_DEADBAND_C: FREEZE_DEADBAND_C,
    SNOW_LIGHT_M: SNOW_LIGHT_M,
    SNOW_LIMITING_M: SNOW_LIMITING_M,
    forecastUrl: forecastUrl,
    formatLocalClock: formatLocalClock,
    hourFromIso: hourFromIso,
    localDateString: localDateString,
    deriveTempTrend: deriveTempTrend,
    deriveFreezeThaw: deriveFreezeThaw,
    pickSnowDepth: pickSnowDepth,
    classifySnowDepth: classifySnowDepth,
    parseForecast: parseForecast,
    fetchForecast: fetchForecast
  };
})(typeof window !== "undefined" ? window : globalThis);
