/**
 * Sheds — Leaflet canvas heat / priority grid overlay (v0.2).
 * Smooth filled cells + optional confidence crosshatch when input coverage is limited.
 */
(function (global) {
  "use strict";

  var HeatGrid = L.GridLayer.extend({
    options: {
      opacity: 0.55,
      zIndex: 350,
      className: "sheds-heat-layer"
    },

    initialize: function (options) {
      L.GridLayer.prototype.initialize.call(this, options);
      this._grid = null;
      this._heatVisible = true;
      this._hostMap = null;
      this._showConfidence = false;
      this._smooth = true;
    },

    onAdd: function (map) {
      this._hostMap = map;
      L.GridLayer.prototype.onAdd.call(this, map);
    },

    createTile: function (coords, done) {
      var tile = document.createElement("canvas");
      tile.width = 256;
      tile.height = 256;
      tile.className = "sheds-heat-tile";
      var self = this;
      setTimeout(function () {
        self._paintTile(tile, coords);
        done(null, tile);
      }, 0);
      return tile;
    },

    _colorFor: function (priority, alphaBoost) {
      var p = Math.max(0, Math.min(1, priority));
      var aMul = alphaBoost != null ? alphaBoost : 1;
      // Soft translucent washes so topo contours stay readable underneath
      if (p < 0.45) return "rgba(70, 120, 105, " + ((0.06 + p * 0.18) * aMul) + ")";
      if (p < 0.72) return "rgba(190, 150, 55, " + ((0.10 + (p - 0.45) * 0.35) * aMul) + ")";
      return "rgba(75, 145, 70, " + ((0.16 + (p - 0.72) * 0.38) * aMul) + ")";
    },

    /** Discrete Phase 2 habitat bands — not rainbow heat, not finer than ~30 m honesty. */
    _colorForBand: function (band, alphaBoost) {
      var aMul = alphaBoost != null ? alphaBoost : 1;
      if (band === "stronger") return "rgba(72, 140, 78, " + 0.34 * aMul + ")";
      if (band === "some") return "rgba(168, 148, 72, " + 0.26 * aMul + ")";
      if (band === "limited") return "rgba(78, 110, 118, " + 0.16 * aMul + ")";
      if (band === "higher") return "rgba(52, 118, 74, " + 0.30 * aMul + ")";
      if (band === "moderate") return "rgba(186, 148, 58, " + 0.18 * aMul + ")";
      if (band === "lower") return "rgba(92, 98, 90, " + 0.10 * aMul + ")";
      return null;
    },

    _isGisMode: function () {
      var grid = this._grid;
      return !!(grid && (grid.renderMode === "gis-bands" || (grid.modelVersion && String(grid.modelVersion).indexOf("habitat-gis") === 0)));
    },

    _isSearchMode: function () {
      var grid = this._grid;
      return !!(grid && grid.renderMode === "search-priority");
    },

    _cellAt: function (row, col) {
      var grid = this._grid;
      if (!grid || row < 0 || col < 0 || row >= grid.rows || col >= grid.cols) return null;
      return grid.cells[row * grid.cols + col];
    },

    _samplePriority: function (rowF, colF) {
      var r0 = Math.floor(rowF);
      var c0 = Math.floor(colF);
      var fr = rowF - r0;
      var fc = colF - c0;
      var a = this._cellAt(r0, c0);
      var b = this._cellAt(r0, c0 + 1);
      var c = this._cellAt(r0 + 1, c0);
      var d = this._cellAt(r0 + 1, c0 + 1);
      var pa = a && !a.outsideArea ? a.priority : 0;
      var pb = b && !b.outsideArea ? b.priority : pa;
      var pc = c && !c.outsideArea ? c.priority : pa;
      var pd = d && !d.outsideArea ? d.priority : pb;
      var top = pa + (pb - pa) * fc;
      var bot = pc + (pd - pc) * fc;
      return top + (bot - top) * fr;
    },

    _paintTile: function (tile, coords) {
      var ctx = tile.getContext("2d");
      ctx.clearRect(0, 0, 256, 256);
      var grid = this._grid;
      if (!this._heatVisible || !grid || !grid.cells || !grid.cells.length) return;
      var map = this._map;
      if (!map || !grid.bounds) return;
      var nw = map.project(L.latLng(grid.bounds.north, grid.bounds.west), coords.z);
      var se = map.project(L.latLng(grid.bounds.south, grid.bounds.east), coords.z);
      var tileX = coords.x * 256;
      var tileY = coords.y * 256;
      var cellW = (se.x - nw.x) / grid.cols;
      var cellH = (se.y - nw.y) / grid.rows;
      var limited = grid.coverage && grid.coverage.level === "limited";
      var gis = this._isGisMode();
      var search = this._isSearchMode();
      var i;

      if (search) {
        for (i = 0; i < grid.cells.length; i++) {
          var sc = grid.cells[i];
          if (!sc || sc.outsideArea || !sc.band) continue;
          var sfill = this._colorForBand(sc.band, 1);
          if (!sfill) continue;
          var sx = nw.x + sc.col * cellW - tileX;
          var sy = nw.y + sc.row * cellH - tileY;
          if (sx > 256 || sy > 256 || sx + cellW < 0 || sy + cellH < 0) continue;
          ctx.fillStyle = sfill;
          ctx.fillRect(sx, sy, Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
          if (sc.band === "higher") {
            ctx.strokeStyle = "rgba(255,255,255,0.10)";
            ctx.strokeRect(sx + 0.5, sy + 0.5, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
          }
        }
        return;
      }

      if (gis) {
        // Discrete cells — no smooth gradient implying sub-resolution precision
        for (i = 0; i < grid.cells.length; i++) {
          var cell = grid.cells[i];
          if (!cell || cell.outsideArea || cell.habitatEmpty) continue;
          var fill = this._colorForBand(cell.band, 1);
          if (!fill) continue;
          var x0 = nw.x + cell.col * cellW - tileX;
          var y0 = nw.y + cell.row * cellH - tileY;
          if (x0 > 256 || y0 > 256 || x0 + cellW < 0 || y0 + cellH < 0) continue;
          ctx.fillStyle = fill;
          ctx.fillRect(x0, y0, Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
          if (cell.band === "stronger") {
            ctx.strokeStyle = "rgba(255,255,255,0.07)";
            ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
          }
        }
      } else if (this._smooth && cellW > 4 && cellH > 4) {
        var step = Math.max(2, Math.min(8, Math.floor(Math.min(cellW, cellH) / 3)));
        for (var y = 0; y < 256; y += step) {
          for (var x = 0; x < 256; x += step) {
            var gx = (tileX + x + step / 2 - nw.x) / cellW;
            var gy = (tileY + y + step / 2 - nw.y) / cellH;
            if (gx < -1 || gy < -1 || gx > grid.cols || gy > grid.rows) continue;
            var p = this._samplePriority(gy, gx);
            ctx.fillStyle = this._colorFor(p, 1);
            ctx.fillRect(x, y, step + 1, step + 1);
          }
        }
      } else {
        for (i = 0; i < grid.cells.length; i++) {
          var cell2 = grid.cells[i];
          var x1 = nw.x + cell2.col * cellW - tileX;
          var y1 = nw.y + cell2.row * cellH - tileY;
          if (x1 > 256 || y1 > 256 || x1 + cellW < 0 || y1 + cellH < 0) continue;
          ctx.fillStyle = this._colorFor(cell2.priority);
          ctx.fillRect(x1, y1, Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
          if (cell2.band === "higher") {
            ctx.strokeStyle = "rgba(255,255,255,0.08)";
            ctx.beginPath();
            ctx.moveTo(x1, y1 + cellH);
            ctx.lineTo(x1 + cellW, y1);
            ctx.stroke();
          }
        }
      }

      // Confidence overlay: hatch when coverage limited or user enabled
      if (this._showConfidence || limited) {
        ctx.strokeStyle = "rgba(228,234,244,0.08)";
        ctx.lineWidth = 1;
        for (var hx = -256; hx < 512; hx += 10) {
          ctx.beginPath();
          ctx.moveTo(hx, 0);
          ctx.lineTo(hx + 256, 256);
          ctx.stroke();
        }
      }
    },

    setGrid: function (next) {
      this._grid = next;
      this.redraw();
    },

    getGrid: function () {
      return this._grid;
    },

    setHeatVisible: function (v) {
      this._heatVisible = !!v;
      var map = this._map || this._hostMap;
      if (!map) return;
      if (this._heatVisible) {
        if (!map.hasLayer(this)) this.addTo(map);
      } else if (map.hasLayer(this)) {
        map.removeLayer(this);
      } else {
        this.redraw();
      }
      if (this._map) this.redraw();
    },

    setHeatOpacity: function (op) {
      this.setOpacity(op);
    },

    setShowConfidence: function (v) {
      this._showConfidence = !!v;
      this.redraw();
    },

    setSmooth: function (v) {
      this._smooth = !!v;
      this.redraw();
    },

    nearestCell: function (latlng) {
      var grid = this._grid;
      if (!grid || !grid.cells) return null;
      var best = null;
      var bestD = Infinity;
      var i;
      for (i = 0; i < grid.cells.length; i++) {
        var c = grid.cells[i];
        if (!c || c.outsideArea) continue;
        var d = Math.pow(c.lat - latlng.lat, 2) + Math.pow(c.lng - latlng.lng, 2);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return best;
    }
  });

  function createHeatLayer(map, options) {
    var layer = new HeatGrid(options || {});
    if (options && options.opacity != null) layer.setOpacity(options.opacity);
    layer.addTo(map);
    return layer;
  }

  global.WaypointShedsHeat = {
    createHeatLayer: createHeatLayer,
    HeatGrid: HeatGrid
  };
})(window);
