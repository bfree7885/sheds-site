# Shed Hunting WDS vendor subset

This directory is a **small, build-time copy** of the Waypoint design-system pieces
the Shed Hunting field map (and the dedicated-host artifact) need.

It exists so Shed Hunting can run from `/apps/shed-hunting/map/` today and from
`https://shedhunting.org/map/` later without `../../../design-system/...` path
traversal, and without a runtime dependency on `waypointstudio.org` CSS.

Do **not** copy the entire design system here.

Sync from the repo root:

```
node scripts/sync-shed-hunting-wds.mjs
```

Keep `wds-origins.js` identical to `design-system/js/platform/wds-origins.js`.
Keep `wds-experience-v2.css` identical to `design-system/css/wds-experience-v2.css`.
