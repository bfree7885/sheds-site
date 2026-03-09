# Sheds Observation Dataset — Research Export Schema

This document describes the observation dataset exported for universities and wildlife researchers. Exports are available in **CSV**, **GeoJSON**, and **shapefile** formats via `GET /observations/export?format=csv|geojson|shapefile`.

## Fields

### Location
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique observation identifier |
| latitude | number | WGS84 latitude |
| longitude | number | WGS84 longitude |
| dateFound | string | Date found (YYYY-MM-DD) |
| createdAt | string | Record creation timestamp (ISO 8601) |

### Terrain variables
| Field | Type | Description |
|-------|------|-------------|
| elevation | number | Elevation in meters |
| slope | number | Slope in degrees |
| aspect | number | Aspect in degrees (0–360) |

### Habitat variables
| Field | Type | Description |
|-------|------|-------------|
| vegetationType | string | open, woodland, edge, riparian, agricultural, brush, other |
| distanceToWater | number | Distance to water in meters |
| distanceToFood | number | Distance to food source in meters |

### Antler characteristics
| Field | Type | Description |
|-------|------|-------------|
| points | number | Number of points |
| tineCount | number | Tine count |
| beamLengthEstimate | number | Estimated beam length in cm |
| ageClass | string | fawn, yearling, adult, mature |
| condition | string | fresh, weathered, chewed, broken |

### Photo metadata (when photo uploaded)
| Field | Type | Description |
|-------|------|-------------|
| photoPath | string | Path to stored image |
| photoExtractedPoints | number | AI-extracted points (if available) |
| photoExtractedBeamLength | number | AI-extracted beam length cm |
| photoExtractedCondition | string | AI-extracted condition |

### Environmental conditions (future)
| Field | Type | Description |
|-------|------|-------------|
| snowDepth | number | Snow depth in cm |
| temperature | number | Temperature °C |
| weather | string | Weather pattern |

Null/missing values are exported as empty string (CSV) or null (GeoJSON/shapefile).

## Citation

When using this dataset in research, please cite:

> Sheds Observation Dataset. Sheds Platform. [URL]. Accessed [date].

## Shapefile field mapping

Shapefile DBF limits attribute names to 10 characters. The shapefile export uses these shortened names:

| Full name | Shapefile column |
|-----------|------------------|
| dateFound | date_found |
| createdAt | created_at |
| elevation | elev |
| vegetationType | vegetation |
| distanceToWater | dist_water |
| distanceToFood | dist_food |
| tineCount | tine_count |
| beamLengthEstimate | beam_len |
| ageClass | age_class |
| photoPath | photo_path |
| photoExtractedPoints | photo_pts |
| photoExtractedBeamLength | photo_beam |
| photoExtractedCondition | photo_cond |
| temperature | temp |

## License

Contact the Sheds project for data use terms.
