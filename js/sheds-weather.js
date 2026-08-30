/**
 * Sheds — shared Open-Meteo forecast parse for map + dedicated-host overview.
 *
 * Does not add snow_depth. snowfall_sum is water-equivalent (SWE), not depth.
 * Hourly temperature_2m is used for an honest recent trend — small changes stay
 * “Little change”.
 */
(function (global) {
  "use strict";

  /** °C. Differences below this are Little change — do not overstate noise. */
  var TEMP_TREND_THRESHOLD_C = 2.0;
  var TREND_HOURS = 3;
  var TREND_LOOKBACK_H = 24;
  var MIN_HOURLY_SAMPLES = 12;
  var MIN_SPAN_HOURS = 12;

  var FORECAST_QUERY =
    "current=temperature_2m,wind_speed_10m,surface_pressure,precipitation" +
    "&hourly=temperature_2m,wind_speed_10m,precipitation,surface_pressure" +
    "&daily=snowfall_sum,sunrise,sunset,precipitation_sum" +
    "&timezone=auto&forecast_days=3&past_days=1";

  function forecastUrl(lat, lng) {
    return "https://api.open-meteo.com/v1/forecast?latitude=" + Number(lat).toFixed(4) +
      "&longitude=" + Number(lng).toFixed(4) +
      "&" + FORECAST_QUERY;
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

  function meanRange(arr, from, to) {
    var n = 0;
    var s = 0;
    var i;
    for (i = from; i <= to; i++) {
      if (typeof arr[i] === "number" && isFinite(arr[i])) {
        s += arr[i];
        n++;
      }
    }
    return n ? s / n : null;
  }

  /**
   * Recent temperature trend from hourly 2m temperatures.
   *
   * Compare the mean of the last TREND_HOURS hours (including the current hour)
   * to the mean of the same-length window ~TREND_LOOKBACK_H hours earlier.
   * Threshold: TEMP_TREND_THRESHOLD_C (2.0 °C).
   *
   * Requires at least MIN_HOURLY_SAMPLES samples spanning MIN_SPAN_HOURS.
   * Missing lookback → status "unknown" (do not invent a trend).
   *
   * @returns {{
   *   status: 'warming'|'cooling'|'little_change'|'unknown',
   *   label: string,
   *   deltaC: number|null,
   *   thresholdC: number,
   *   samplesUsed: number,
   *   detail: string
   * }}
   */
  function deriveTempTrend(hourlyTimes, hourlyTemps, now) {
    var unknown = {
      status: "unknown",
      label: "Temperature trend unknown",
      deltaC: null,
      thresholdC: TEMP_TREND_THRESHOLD_C,
      samplesUsed: 0,
      detail: "Not enough hourly temperatures to judge a recent trend."
    };
    if (!hourlyTimes || !hourlyTemps || hourlyTimes.length !== hourlyTemps.length) {
      return unknown;
    }
    var nowMs = (now instanceof Date ? now : new Date(now)).getTime();
    if (!isFinite(nowMs)) return unknown;

    var times = [];
    var temps = [];
    var i;
    for (i = 0; i < hourlyTimes.length; i++) {
      var t = new Date(hourlyTimes[i]).getTime();
      if (!isFinite(t)) continue;
      if (typeof hourlyTemps[i] !== "number" || !isFinite(hourlyTemps[i])) continue;
      times.push(t);
      temps.push(hourlyTemps[i]);
    }
    if (temps.length < MIN_HOURLY_SAMPLES) return unknown;
    var spanH = (times[times.length - 1] - times[0]) / 3600000;
    if (spanH < MIN_SPAN_HOURS) return unknown;

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
    if (nowIdx < 0) return unknown;

    var recentFrom = Math.max(0, nowIdx - (TREND_HOURS - 1));
    var recent = meanRange(temps, recentFrom, nowIdx);
    var lookbackIdx = -1;
    var target = times[nowIdx] - TREND_LOOKBACK_H * 3600000;
    best = Infinity;
    for (i = 0; i < times.length; i++) {
      var gap = Math.abs(times[i] - target);
      if (gap < best && gap <= 2.5 * 3600000) {
        best = gap;
        lookbackIdx = i;
      }
    }
    if (lookbackIdx < 0 || lookbackIdx >= nowIdx) {
      return {
        status: "unknown",
        label: "Temperature trend unknown",
        deltaC: null,
        thresholdC: TEMP_TREND_THRESHOLD_C,
        samplesUsed: temps.length,
        detail: "Hourly temperatures do not span a full day, so a day-to-day trend is not claimed."
      };
    }
    var pastFrom = Math.max(0, lookbackIdx - (TREND_HOURS - 1));
    var past = meanRange(temps, pastFrom, lookbackIdx);
    if (recent == null || past == null) return unknown;

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
      label = "Little change";
    }
    return {
      status: status,
      label: label,
      deltaC: rounded,
      thresholdC: TEMP_TREND_THRESHOLD_C,
      samplesUsed: (nowIdx - recentFrom + 1) + (lookbackIdx - pastFrom + 1),
      detail: status === "little_change"
        ? ("About " + (rounded >= 0 ? "+" : "") + rounded + " °C vs ~24 hours earlier — below the " +
          TEMP_TREND_THRESHOLD_C + " °C threshold, so this is little change.")
        : (label + " about " + (rounded >= 0 ? "+" : "") + rounded +
          " °C versus the same hours a day earlier (threshold " + TEMP_TREND_THRESHOLD_C + " °C).")
    };
  }

  /**
   * Parse Open-Meteo JSON into the weather package used by Today's Search / Hunt.
   * snowMm is snowfall water-equivalent, never depth.
   */
  function parseForecast(json, now) {
    if (!json || !json.current) {
      return { ready: false, reason: "empty", snowDepthKnown: false };
    }
    var data = json;
    var nowDate = now instanceof Date ? now : (now ? new Date(now) : new Date());
    var snow = 0;
    if (data.daily && data.daily.snowfall_sum) {
      snow = data.daily.snowfall_sum.reduce(function (a, b) { return a + (b || 0); }, 0);
    }
    var influence = 1;
    if (snow > 25) influence = 0.7;
    else if (snow > 8) influence = 0.88;
    else if (snow > 0.5) influence = 1.05;

    var tempC = data.current && typeof data.current.temperature_2m === "number"
      ? data.current.temperature_2m : null;
    var windSpeedMs = data.current && typeof data.current.wind_speed_10m === "number"
      ? data.current.wind_speed_10m : null;
    var pressureHpa = data.current && typeof data.current.surface_pressure === "number"
      ? data.current.surface_pressure : null;
    var precipNowMm = data.current && typeof data.current.precipitation === "number"
      ? data.current.precipitation : null;

    var precipMm24h = null;
    if (data.daily && data.daily.precipitation_sum && data.daily.precipitation_sum.length) {
      var sums = data.daily.precipitation_sum;
      precipMm24h = Number(sums[sums.length > 1 ? 1 : 0] || 0);
      if (sums.length > 1) precipMm24h = Number(sums[0] || 0) + Number(sums[1] || 0);
    }

    var pressureTrend = null;
    if (data.hourly && data.hourly.surface_pressure && data.hourly.surface_pressure.length >= 6) {
      var arr = data.hourly.surface_pressure.filter(function (v) { return typeof v === "number"; });
      if (arr.length >= 6) {
        var early = arr[Math.max(0, arr.length - 12)];
        var late = arr[arr.length - 1];
        var delta = late - early;
        if (delta <= -1.5) pressureTrend = "falling";
        else if (delta >= 1.5) pressureTrend = "rising";
        else pressureTrend = "steady";
      }
    }

    var sunriseIso = data.daily && data.daily.sunrise ? data.daily.sunrise[data.daily.sunrise.length > 1 ? 1 : 0] : null;
    var sunsetIso = data.daily && data.daily.sunset ? data.daily.sunset[data.daily.sunset.length > 1 ? 1 : 0] : null;
    if (data.daily && data.daily.time && data.daily.time.length) {
      var todayStr = nowDate.toISOString().slice(0, 10);
      var ix = data.daily.time.indexOf(todayStr);
      if (ix < 0 && data.daily.time.length > 1) ix = 1;
      if (ix < 0) ix = 0;
      sunriseIso = data.daily.sunrise && data.daily.sunrise[ix];
      sunsetIso = data.daily.sunset && data.daily.sunset[ix];
    }

    var hourlyTimes = data.hourly && data.hourly.time ? data.hourly.time : [];
    var hourlyTemps = data.hourly && data.hourly.temperature_2m ? data.hourly.temperature_2m : [];
    var hourlyPrecip = data.hourly && data.hourly.precipitation ? data.hourly.precipitation : [];
    var hourlyWinds = data.hourly && data.hourly.wind_speed_10m ? data.hourly.wind_speed_10m : [];
    var tempTrend = deriveTempTrend(hourlyTimes, hourlyTemps, nowDate);

    return {
      ready: true,
      snowInfluence: influence,
      snowMm: snow,
      snowDepthKnown: false,
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
      tempTrend: tempTrend,
      source: "open-meteo",
      fetchedAt: nowDate.toISOString()
    };
  }

  function fetchForecast(lat, lng, now) {
    if (!isFinite(lat) || !isFinite(lng)) {
      return Promise.resolve({ ready: false, reason: "no-location", snowDepthKnown: false });
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
    MIN_HOURLY_SAMPLES: MIN_HOURLY_SAMPLES,
    forecastUrl: forecastUrl,
    formatLocalClock: formatLocalClock,
    hourFromIso: hourFromIso,
    deriveTempTrend: deriveTempTrend,
    parseForecast: parseForecast,
    fetchForecast: fetchForecast
  };
})(typeof window !== "undefined" ? window : globalThis);
