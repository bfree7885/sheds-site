# Sheds Heatmap Data Model

Each shed observation should record the following information.

## Location
- Latitude
- Longitude
- Date found

## Terrain variables
- Slope (°)
- Aspect (°)
- Elevation (m)

## Habitat variables
- Vegetation type
- Distance to water (m)
- Distance to food source (m)

## Antler characteristics
- Points
- Tine count
- Beam length estimate (cm)
- Estimated deer age class
- Condition

## Environmental conditions (future)
- Snow depth
- Temperature
- Weather pattern

These variables allow the heatmap model to identify terrain patterns
that influence shed distribution. The API and Field View form support
all fields above except environmental conditions.

**Use:** This dataset is designed to train terrain-based shed probability models (e.g. slope, aspect, elevation, habitat, and antler characteristics as predictors).
