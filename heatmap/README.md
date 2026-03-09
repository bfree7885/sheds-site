# Shed probability heatmap

Generates a **shed probability** grid from observation data and writes `api/heatmap.json` for the Field View overlay.

## Steps

1. **Read** all observations from `api/observations.json`
2. **Extract** terrain/habitat features: slope, aspect, elevation, vegetation type, distance to water/food
3. **Train** a Random Forest classifier (positives = observations, synthetic negatives = random points in bounds)
4. **Predict** probability on a regular lat/lng grid
5. **Write** GeoJSON `FeatureCollection` of polygon cells with `probability` property

## Run

From repo root (use a virtualenv if your system restricts pip):

```bash
python3 -m venv heatmap/.venv
heatmap/.venv/bin/pip install -r heatmap/requirements.txt
heatmap/.venv/bin/python heatmap/generate_heatmap.py
```

Or, if you can install into your environment:

```bash
pip install -r heatmap/requirements.txt
python heatmap/generate_heatmap.py
```

Requires at least **2 observations**. Output: `api/heatmap.json`. The API serves it at `GET /heatmap`; Field View loads it and shows it when **Shed probability** is toggled on (semi-transparent green overlay).

## Options

Edit `generate_heatmap.py`:

- `GRID_STEP_DEG` — grid cell size in degrees (~0.05 ≈ 5 km)
- `NEGATIVE_MULTIPLIER` — synthetic negatives per observation (default 3)
- `PADDING` — degrees added around observation bounds

## Model

- **Classifier:** `sklearn.ensemble.RandomForestClassifier` (50 trees, max depth 6)
- **Features:** lat, lng, elevation, slope, aspect, distanceToWater, distanceToFood, vegetation (label-encoded)
- **Missing values:** imputed with median
