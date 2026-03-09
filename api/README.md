# Sheds Observation API (Phase 0)

Minimal API for storing and listing shed observations. No database — uses `observations.json` in this folder.

## Run locally

```bash
cd api
npm install
npm start
```

Then open **http://localhost:3000/fieldview.html** in your browser. The same server serves the static site and the API.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/observations` | List all observations (JSON array) |
| POST | `/observations` | Create one observation (JSON body) |

## POST /observations (JSON)

**Required:** `latitude`, `longitude`

**Optional:** `dateFound`, terrain (elevation, slope, aspect), habitat (vegetationType, distanceToWater, distanceToFood), antler (points, tineCount, beamLengthEstimate, ageClass, condition).

## GET /observations/export?format=csv|geojson|shapefile

Research dataset export for universities and wildlife researchers. Includes location, terrain, habitat, antler characteristics, photo metadata, and environmental fields (when collected).

| Format   | Output                          |
|----------|---------------------------------|
| `csv`    | `sheds-observations-YYYY-MM-DD.csv` |
| `geojson`| `sheds-observations-YYYY-MM-DD.geojson` |
| `shapefile` | `sheds-observations-YYYY-MM-DD.zip` (contains .shp, .shx, .dbf) |

**Fields:** id, latitude, longitude, dateFound, createdAt, elevation, slope, aspect, vegetationType, distanceToWater, distanceToFood, points, tineCount, beamLengthEstimate, ageClass, condition, photoPath, photoExtractedPoints, photoExtractedBeamLength, photoExtractedCondition, snowDepth, temperature, weather.

## POST /observations/with-photo (multipart/form-data)

Same fields as above as form fields, plus `photo` (image file). The image is stored under `uploads/` and the observation gets `photoPath`. If `OPENAI_API_KEY` is set, the API calls a vision model to extract antler features (points, beam length, condition) and stores them as `photoExtractedPoints`, `photoExtractedBeamLength`, `photoExtractedCondition`, and merges them into the observation when the user did not provide values. Photos are served at `GET /uploads/:filename`.

## Port

Default port is 3000. Override with `PORT=4000 npm start`.
