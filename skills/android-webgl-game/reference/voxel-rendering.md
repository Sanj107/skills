# Voxel rendering with three.js on phones

## Models

`js/voxel.js` (template) provides `Vox` — a sparse map of integer cells to colours with helpers
`set`, `box`, `ball` (ellipsoid; colour may be a function of x,y,z), `line(…, r)` — and
`mesh(vox, {scale, center, noise})` → `BufferGeometry`:

- emits only faces whose neighbour cell is empty;
- bakes per-face shading (top 1.0, sides 0.82–0.92, bottom 0.55) and **vertex ambient occlusion**
  from the 3 neighbours of each corner (`ao = s1&&s2 ? 0 : 3-(s1+s2+c)`), flipping the quad
  diagonal to avoid AO anisotropy;
- adds ±5% stable per-voxel colour noise so flat areas look hand-painted;
- uses one shared `MeshLambertMaterial({vertexColors: true})`.

Write builders as code (`ship(tier, style)`, `crab(size)`, `building(id)`), keep palettes in
style tables, and cache geometries by a key (`'ship:3:navy'`). Animated models are several
parts (meshes) in a `Group`: claws, tentacles, humps, arms — animate their rotations, not vertices.

Typical sizes at `scale 0.25`: a ship 18–46 voxels long (4.5–11.5 units), a building on a 7×7
footprint, an island ~50×50 voxels. A whole island scene is a few hundred thousand triangles at most.

## Colours

- Expand `#abc` to `#aabbcc` before `parseInt(…, 16)` — otherwise `#fff` becomes blue.
- Keep `renderer.outputEncoding` at the default when colours are authored by eye; sRGB output
  without converting the colours makes the image pale.
- Light white sails/walls look grey on side faces; pick slightly warmer whites (`#f2efe6`).
- Put emblems in a contrasting colour (a white skull on a white sail disappears).

## Camera on portrait phones

At a 60° vertical FOV and 9:19 aspect the horizontal FOV is only ~30°. Guessing distances fails
for long objects. Fit instead:

```js
// corners: bounding box of everything that must be visible; free band: NDC y range not under the HUD
for (let d = 8, i = 0; i < 60; i++, d *= 1.06) {
  cam.position.copy(target).addScaledVector(dir, d); cam.lookAt(target); cam.updateMatrixWorld();
  if (corners.every(c => { const p = c.clone().project(cam); return Math.abs(p.x) < 0.94 && p.y > yMin && p.y < yMax; })) break;
}
```

A three-quarter view (yaw ~0.3 rad, pitch ~0.8 rad) shows two ships side by side much better than a
pure side view. When a bottom sheet covers part of the screen, shift the picture with
`camera.setViewOffset(w, h, 0, h * cover / 2, w, h)` instead of moving the camera.

## Sea, sky, particles

- Sea: a 72×72-segment plane, positions rewritten each frame from a few sines,
  `MeshPhongMaterial({flatShading: true, specular})` — cheap low-poly glitter.
- Day/night: interpolate background, fog, sea colour and light intensities from a keyframe table;
  points for stars, opacity by darkness.
- Particles (coins, splashes, debris, smoke, muzzle flashes): one `InstancedMesh` of unit cubes
  (≈700 instances) with `instanceColor`; update matrices each frame; shrink to fade.
- Damage numbers and labels are DOM elements positioned with `vector.project(camera)`.

## Performance budget (mid-range Android)

- `setPixelRatio(min(devicePixelRatio, 2))`, 1.5 when DPR > 2.5, 1 in a "low" setting; antialias only on high.
- No shadow maps; Lambert materials; merge static voxels into one mesh per object.
- Keep draw calls under ~100. Hide groups that are off-stage instead of rebuilding.
- `requestAnimationFrame` loop with `dt = min(0.1, …)`; simulation at a fixed step (e.g. 0.05 s).
