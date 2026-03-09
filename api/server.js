/**
 * Sheds Observation API
 * Serves the static site and observation CRUD.
 * Storage: api/observations.json (no database).
 * Observation schema is research-grade for training terrain-based shed probability models.
 *
 * Run: npm start (from api/)
 * Then open http://localhost:3000/fieldview.html
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'observations.json');
const HEATMAP_FILE = path.join(__dirname, 'heatmap.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = `obs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const ext = (file.mimetype === 'image/png') ? 'png' : 'jpg';
    cb(null, `${id}.${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());

// Serve static site (parent directory = repo root)
app.use(express.static(path.join(__dirname, '..')));
// Serve uploaded shed photos
app.use('/uploads', express.static(UPLOADS_DIR));

// Ensure data file exists
function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  }
}

function readObservations() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeObservations(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function buildObservationFromBody(body, extra = {}) {
  const lat = Number(body.latitude ?? body.lat);
  const lng = Number(body.longitude ?? body.lng);
  const dateFound = body.dateFound || new Date().toISOString().slice(0, 10);
  const num = (v) => (v != null && v !== '') ? Number(v) : null;
  const str = (v) => (v != null && v !== '') ? String(v) : null;
  return {
    id: extra.id || `obs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    latitude: lat,
    longitude: lng,
    dateFound,
    elevation: num(body.elevation),
    slope: num(body.slope),
    aspect: num(body.aspect),
    vegetationType: str(body.vegetationType),
    distanceToWater: num(body.distanceToWater),
    distanceToFood: num(body.distanceToFood),
    points: num(body.points),
    tineCount: num(body.tineCount),
    beamLengthEstimate: num(body.beamLengthEstimate),
    ageClass: str(body.ageClass),
    condition: str(body.condition),
    createdAt: extra.createdAt || new Date().toISOString(),
    ...extra,
  };
}

async function extractAntlerFromPhoto(filePath) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const buf = fs.readFileSync(filePath);
    const base64 = buf.toString('base64');
    const mime = path.extname(filePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Look at this photo of a shed antler (deer antler). Reply with ONLY a JSON object, no other text, with these keys:
- points: number of points (tines) or null if unclear
- beamLengthCm: estimated beam length in cm or null
- condition: one of "fresh", "chewed", "weathered", "old" or null

Example: {"points":5,"beamLengthCm":45,"condition":"fresh"}`,
              },
              {
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${base64}` },
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    const json = JSON.parse(content);
    return {
      points: json.points != null ? Number(json.points) : null,
      beamLengthCm: json.beamLengthCm != null ? Number(json.beamLengthCm) : null,
      condition: json.condition && /^(fresh|chewed|weathered|old)$/i.test(json.condition) ? json.condition.toLowerCase() : null,
    };
  } catch (e) {
    return null;
  }
}

// Research export: all fields for universities and wildlife researchers
const EXPORT_FIELDS = [
  'id', 'latitude', 'longitude', 'dateFound', 'createdAt',
  'elevation', 'slope', 'aspect',
  'vegetationType', 'distanceToWater', 'distanceToFood',
  'points', 'tineCount', 'beamLengthEstimate', 'ageClass', 'condition',
  'photoPath', 'photoExtractedPoints', 'photoExtractedBeamLength', 'photoExtractedCondition',
  'snowDepth', 'temperature', 'weather',
];

function observationsToGeoJSON(observations) {
  return {
    type: 'FeatureCollection',
    features: observations.map((o) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [o.longitude, o.latitude] },
      properties: Object.fromEntries(
        EXPORT_FIELDS.map((f) => [f, o[f] ?? null])
      ),
    })),
  };
}

// Shapefile DBF limits field names to 10 chars; map long names to short
const SHP_FIELD_MAP = {
  id: 'id',
  latitude: 'lat',
  longitude: 'lon',
  dateFound: 'date_found',
  createdAt: 'created_at',
  elevation: 'elev',
  slope: 'slope',
  aspect: 'aspect',
  vegetationType: 'vegetation',
  distanceToWater: 'dist_water',
  distanceToFood: 'dist_food',
  points: 'points',
  tineCount: 'tine_count',
  beamLengthEstimate: 'beam_len',
  ageClass: 'age_class',
  condition: 'condition',
  photoPath: 'photo_path',
  photoExtractedPoints: 'photo_pts',
  photoExtractedBeamLength: 'photo_beam',
  photoExtractedCondition: 'photo_cond',
  snowDepth: 'snow_depth',
  temperature: 'temp',
  weather: 'weather',
};

function observationsToShapefileGeoJSON(observations) {
  return {
    type: 'FeatureCollection',
    features: observations.map((o) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [o.longitude, o.latitude] },
      properties: Object.fromEntries(
        EXPORT_FIELDS.map((f) => [SHP_FIELD_MAP[f] || f.slice(0, 10), o[f] ?? null])
      ),
    })),
  };
}

function observationsToCSV(observations) {
  const headers = EXPORT_FIELDS.join(',');
  const rows = observations.map((o) =>
    EXPORT_FIELDS.map((f) => {
      const v = o[f];
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  return [headers, ...rows].join('\n');
}

// GET /observations — list all
app.get('/observations', (req, res) => {
  try {
    const observations = readObservations();
    res.json(observations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read observations' });
  }
});

// GET /observations/export?format=csv|geojson|shapefile — research dataset export
app.get('/observations/export', (req, res) => {
  try {
    const observations = readObservations();
    const format = (req.query.format || 'geojson').toLowerCase();
    const dateStr = new Date().toISOString().slice(0, 10);
    const baseName = `sheds-observations-${dateStr}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      return res.send(observationsToCSV(observations));
    }

    if (format === 'geojson') {
      res.setHeader('Content-Type', 'application/geo+json');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.geojson"`);
      return res.json(observationsToGeoJSON(observations));
    }

    if (format === 'shapefile') {
      const shpwrite = require('@mapbox/shp-write');
      const geojson = observationsToShapefileGeoJSON(observations);
      const zipBuffer = shpwrite.zip(geojson);
      const buf = Buffer.isBuffer(zipBuffer) ? zipBuffer : Buffer.from(zipBuffer);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.zip"`);
      return res.send(buf);
    }

    res.status(400).json({ error: 'Format must be csv, geojson, or shapefile' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to export observations' });
  }
});

// Terrain-based shed probability heatmap
const HEATMAP_SCRIPT = path.join(__dirname, '..', 'heatmap', 'generate_heatmap.py');
const HEATMAP_GRID_STEP = 0.02;  // ~2 km at mid-latitudes (Node fallback)
const HEATMAP_SIGMA = 0.03;      // kernel decay distance (Node fallback)
const HEATMAP_PADDING = 1.0;     // degrees around observation bounds

function runPythonHeatmapGenerator() {
  if (!fs.existsSync(HEATMAP_SCRIPT)) return false;
  const result = spawnSync('python3', [HEATMAP_SCRIPT], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 60000,
  });
  return result.status === 0 && fs.existsSync(HEATMAP_FILE);
}

function generateHeatmapFromObservations(observations) {
  const valid = observations.filter(
    (o) => o.latitude != null && o.longitude != null && !Number.isNaN(o.latitude) && !Number.isNaN(o.longitude)
  );
  if (valid.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const lats = valid.map((o) => o.latitude);
  const lngs = valid.map((o) => o.longitude);
  const west = Math.min(...lngs) - HEATMAP_PADDING;
  const east = Math.max(...lngs) + HEATMAP_PADDING;
  const south = Math.min(...lats) - HEATMAP_PADDING;
  const north = Math.max(...lats) + HEATMAP_PADDING;

  const features = [];
  const sigma2 = HEATMAP_SIGMA * HEATMAP_SIGMA;

  for (let lat = south; lat < north; lat += HEATMAP_GRID_STEP) {
    for (let lng = west; lng < east; lng += HEATMAP_GRID_STEP) {
      let sum = 0;
      for (const o of valid) {
        const dlat = lat + HEATMAP_GRID_STEP / 2 - o.latitude;
        const dlng = lng + HEATMAP_GRID_STEP / 2 - o.longitude;
        const d2 = dlat * dlat + dlng * dlng;
        sum += Math.exp(-d2 / (2 * sigma2));
      }
      const probability = Math.min(1, Math.max(0, sum / Math.max(valid.length, 1)));
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [lng, lat],
            [lng + HEATMAP_GRID_STEP, lat],
            [lng + HEATMAP_GRID_STEP, lat + HEATMAP_GRID_STEP],
            [lng, lat + HEATMAP_GRID_STEP],
            [lng, lat],
          ]],
        },
        properties: { probability: Math.round(probability * 10000) / 10000 },
      });
    }
  }

  // Normalize probabilities to 0–1 range for better visual contrast
  const probs = features.map((f) => f.properties.probability);
  const minP = Math.min(...probs);
  const maxP = Math.max(...probs);
  const range = maxP - minP || 1;
  for (const f of features) {
    f.properties.probability = Math.round(((f.properties.probability - minP) / range) * 10000) / 10000;
  }

  return { type: 'FeatureCollection', features };
}

// GET /heatmap — shed probability grid (GeoJSON)
// 1. Serve heatmap.json if present (from heatmap/generate_heatmap.py)
// 2. Else run Python script if available (terrain-based RF model)
// 3. Else generate spatial kernel density from observations (Node fallback)
app.get('/heatmap', (req, res) => {
  try {
    if (fs.existsSync(HEATMAP_FILE)) {
      const raw = fs.readFileSync(HEATMAP_FILE, 'utf8');
      return res.json(JSON.parse(raw));
    }
    const observations = readObservations();
    if (observations.length >= 2 && runPythonHeatmapGenerator()) {
      const raw = fs.readFileSync(HEATMAP_FILE, 'utf8');
      return res.json(JSON.parse(raw));
    }
    const geojson = generateHeatmapFromObservations(observations);
    res.json(geojson);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read heatmap' });
  }
});

// POST /observations — create one (JSON body)
app.post('/observations', (req, res) => {
  const body = req.body || {};
  const lat = Number(body.latitude ?? body.lat);
  const lng = Number(body.longitude ?? body.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Valid latitude and longitude required' });
  }
  const observation = buildObservationFromBody(body);
  try {
    const observations = readObservations();
    observations.push(observation);
    writeObservations(observations);
    if (fs.existsSync(HEATMAP_FILE)) fs.unlinkSync(HEATMAP_FILE);
    res.status(201).json(observation);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save observation' });
  }
});

// POST /observations/with-photo — create observation with photo; extract antler features if OPENAI_API_KEY set
app.post('/observations/with-photo', upload.single('photo'), async (req, res) => {
  const body = req.body || {};
  const lat = Number(body.latitude ?? body.lat);
  const lng = Number(body.longitude ?? body.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Valid latitude and longitude required' });
  }
  const id = `obs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  let photoPath = null;
  let photoExtractedPoints = null;
  let photoExtractedBeamLength = null;
  let photoExtractedCondition = null;
  if (req.file) {
    photoPath = `uploads/${req.file.filename}`;
    const extracted = await extractAntlerFromPhoto(req.file.path);
    if (extracted) {
      photoExtractedPoints = extracted.points;
      photoExtractedBeamLength = extracted.beamLengthCm;
      photoExtractedCondition = extracted.condition;
    }
  }
  const observation = buildObservationFromBody(body, {
    id,
    photoPath,
    photoExtractedPoints,
    photoExtractedBeamLength,
    photoExtractedCondition,
  });
  if (photoExtractedPoints != null && observation.points == null) observation.points = photoExtractedPoints;
  if (photoExtractedBeamLength != null && observation.beamLengthEstimate == null) observation.beamLengthEstimate = photoExtractedBeamLength;
  if (photoExtractedCondition != null && !observation.condition) observation.condition = photoExtractedCondition;
  try {
    const observations = readObservations();
    observations.push(observation);
    writeObservations(observations);
    if (fs.existsSync(HEATMAP_FILE)) fs.unlinkSync(HEATMAP_FILE);
    res.status(201).json(observation);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save observation' });
  }
});

app.listen(PORT, () => {
  console.log(`Sheds API running at http://localhost:${PORT}`);
  console.log(`  Field View: http://localhost:${PORT}/fieldview.html`);
  console.log(`  Observations: GET/POST http://localhost:${PORT}/observations`);
});
