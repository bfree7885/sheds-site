#!/usr/bin/env python3
"""
Shed probability heatmap generator.

1. Reads observations from api/observations.json
2. Extracts terrain/habitat features (slope, aspect, elevation, vegetation)
3. Trains a simple model (random forest) with synthetic negatives
4. Outputs a GeoJSON grid (heatmap.json) for Field View overlay

Run from repo root: python heatmap/generate_heatmap.py
Or: cd heatmap && python generate_heatmap.py
"""

import json
import os
import sys
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import LabelEncoder

# Paths
REPO_ROOT = Path(__file__).resolve().parent.parent
OBS_FILE = REPO_ROOT / "api" / "observations.json"
OUT_FILE = REPO_ROOT / "api" / "heatmap.json"

# Grid and model settings
GRID_STEP_DEG = 0.05  # ~5 km at mid-latitudes
NEGATIVE_MULTIPLIER = 3  # number of synthetic negatives = N_obs * this
DEFAULT_BOUNDS = (-125, 24, -66, 50)  # (west, south, east, north) US approx
PADDING = 2.0  # degrees padding around observation bounds


def load_observations(path):
    with open(path) as f:
        return json.load(f)


def extract_features(obs):
    """Extract numeric and categorical features from one observation."""
    lat = obs.get("latitude")
    lng = obs.get("longitude")
    if lat is None or lng is None:
        return None
    elev = obs.get("elevation")
    slope = obs.get("slope")
    aspect = obs.get("aspect")
    veg = obs.get("vegetationType") or ""
    dist_water = obs.get("distanceToWater")
    dist_food = obs.get("distanceToFood")
    # Use NaN for missing numerics; model will impute
    return {
        "lat": float(lat),
        "lng": float(lng),
        "elevation": float(elev) if elev is not None else np.nan,
        "slope": float(slope) if slope is not None else np.nan,
        "aspect": float(aspect) if aspect is not None else np.nan,
        "vegetation": veg,
        "distanceToWater": float(dist_water) if dist_water is not None else np.nan,
        "distanceToFood": float(dist_food) if dist_food is not None else np.nan,
    }


def build_training_data(observations):
    if not observations:
        return None, None, None, None

    rows = []
    for o in observations:
        f = extract_features(o)
        if f is not None:
            rows.append(f)

    if not rows:
        return None, None, None, None

    # Encode vegetation
    veg_values = [r["vegetation"] for r in rows]
    all_veg = list(set(veg_values))
    if "" not in all_veg:
        all_veg.append("")
    le = LabelEncoder()
    le.fit(all_veg)
    veg_encoded = le.transform(veg_values)

    # Numeric feature matrix for positives
    X_pos = np.array([
        [r["lat"], r["lng"], r["elevation"], r["slope"], r["aspect"],
         r["distanceToWater"], r["distanceToFood"], veg_encoded[i]]
        for i, r in enumerate(rows)
    ])

    # Bounds from data
    lats = [r["lat"] for r in rows]
    lngs = [r["lng"] for r in rows]
    west = min(lngs) - PADDING
    east = max(lngs) + PADDING
    south = min(lats) - PADDING
    north = max(lats) + PADDING

    # Synthetic negatives: random (lat, lng), sample other features from positives
    n_neg = min(len(rows) * NEGATIVE_MULTIPLIER, 5000)
    np.random.seed(42)
    neg_lat = np.random.uniform(south, north, n_neg)
    neg_lng = np.random.uniform(west, east, n_neg)
    # Sample elevation, slope, aspect, dist from observed (with small noise)
    idx = np.random.randint(0, len(rows), n_neg)
    neg_elev = np.array([rows[i]["elevation"] for i in idx])
    neg_slope = np.array([rows[i]["slope"] for i in idx])
    neg_aspect = np.array([rows[i]["aspect"] for i in idx])
    neg_dw = np.array([rows[i]["distanceToWater"] for i in idx])
    neg_df = np.array([rows[i]["distanceToFood"] for i in idx])
    neg_veg = le.transform([rows[idx[i]]["vegetation"] for i in range(n_neg)])
    # Add noise so negatives aren't identical to positives
    neg_elev = neg_elev + np.random.normal(0, 50, n_neg)
    neg_slope = np.maximum(0, neg_slope + np.random.normal(0, 2, n_neg))
    neg_aspect = np.clip(neg_aspect + np.random.normal(0, 20, n_neg), 0, 360)
    X_neg = np.column_stack([neg_lat, neg_lng, neg_elev, neg_slope, neg_aspect, neg_dw, neg_df, neg_veg])

    X = np.vstack([X_pos, X_neg])
    y = np.array([1] * len(X_pos) + [0] * len(X_neg))

    # Impute missing numerics (NaN)
    imputer = SimpleImputer(strategy="median")
    X_imputed = imputer.fit_transform(X)

    return X_imputed, y, imputer, (west, south, east, north), le


def train_model(X, y):
    clf = RandomForestClassifier(n_estimators=50, max_depth=6, random_state=42)
    clf.fit(X, y)
    return clf


def grid_cells(bounds, step_deg):
    west, south, east, north = bounds
    lat = south
    cells = []
    while lat < north:
        lng = west
        while lng < east:
            # Polygon: small square [lng, lat] to [lng+step, lat+step]
            cells.append({
                "lng": lng + step_deg / 2,
                "lat": lat + step_deg / 2,
                "coords": [
                    [lng, lat],
                    [lng + step_deg, lat],
                    [lng + step_deg, lat + step_deg],
                    [lng, lat + step_deg],
                    [lng, lat],
                ],
            })
            lng += step_deg
        lat += step_deg
    return cells


def predict_grid(model, imputer, le, bounds, step_deg, default_veg_encoded=0):
    west, south, east, north = bounds
    cells = grid_cells(bounds, step_deg)
    # Default feature vector for grid centers: use median-ish and mode vegetation
    # We don't have real terrain at every grid point; use global medians from training
    # (imputer has been fit on X which had pos+neg)
    median_elev = float(imputer.statistics_[2])
    median_slope = float(imputer.statistics_[3])
    median_aspect = float(imputer.statistics_[4])
    median_dw = float(imputer.statistics_[5])
    median_df = float(imputer.statistics_[6])

    X_grid = np.array([
        [c["lat"], c["lng"], median_elev, median_slope, median_aspect,
         median_dw, median_df, default_veg_encoded]
        for c in cells
    ])
    proba = model.predict_proba(X_grid)[:, 1]
    for c, p in zip(cells, proba):
        c["probability"] = round(float(p), 4)
    return cells


def to_geojson(cells):
    features = []
    for c in cells:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [c["coords"]],
            },
            "properties": {"probability": c["probability"]},
        })
    return {"type": "FeatureCollection", "features": features}


def main():
    if not OBS_FILE.exists():
        print(f"Observations file not found: {OBS_FILE}", file=sys.stderr)
        sys.exit(1)

    observations = load_observations(OBS_FILE)
    if len(observations) < 2:
        print("Need at least 2 observations to train heatmap model.", file=sys.stderr)
        # Write empty GeoJSON so the layer doesn't break
        out = {"type": "FeatureCollection", "features": []}
        OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(OUT_FILE, "w") as f:
            json.dump(out, f, indent=2)
        print("Wrote empty heatmap.json")
        return

    result = build_training_data(observations)
    if result[0] is None:
        print("No valid observations with coordinates.", file=sys.stderr)
        sys.exit(1)
    X, y, imputer, bounds, le = result

    model = train_model(X, y)
    try:
        default_veg = le.transform([""])[0]
    except ValueError:
        default_veg = 0
    cells = predict_grid(model, imputer, le, bounds, GRID_STEP_DEG, default_veg)
    geojson = to_geojson(cells)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(geojson, f, indent=2)

    print(f"Wrote {OUT_FILE} ({len(cells)} cells, {len(observations)} observations)")


if __name__ == "__main__":
    main()
