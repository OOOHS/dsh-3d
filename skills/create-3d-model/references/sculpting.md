# Native brush editing

Choose brushes when a local contour, soft volume or irregular surface is easier to shape through direct image feedback. Code remains useful for exact construction, topology and assembly; both edit the same scene. Grab moves a local silhouette, Draw/Inflate change volume, and Smooth blends the surface. A small reversible stroke can test whether direct shaping helps the current defect.

## Editing contract

Choose a visible mesh with enough vertices in the region you want to shape. For a sparse mesh, add actual base-mesh subdivisions with Python first; inspect its current modifiers before applying topology changes. This bridge edits fixed-topology base meshes. Apply or remove Multires, use a base mesh with Shape Keys resolved, and keep Dynamic Topology disabled at entry. In the shared scene, call `blender_sculpt` with `action: "begin"`, `object_name` and an optional `preset` such as `front`. The scene remains the one used by `blender_execute`. The legacy file interface also accepts `blend_path`.

Entry opens a viewport framed on the selected component and returns its image immediately. The target is orange and context is gray; these temporary display colors preserve actual materials. `view.target.screen_bounds` gives the projected box, and `surface_samples` give raycast-confirmed target points with world locations and normals. These points are possible aiming locations; choose strokes according to the intended shape. Each stroke also returns an updated image; the observations needed for brushing are included in those tool results. Keep its `edit_id` and latest `view_id`. During editing, each `stroke` returns a new image and updated geometry evidence. Continue applying strokes and observing their effect for as long as useful.

- Brush choices: `draw`, `grab`, `smooth`, `inflate`, `clay`, `clay_strips`, `draw_sharp`, `crease`, `pinch`, `flatten`, `scrape`, `elastic_grab`, `snake_hook`, `layer`. Set `invert: true` for the opposite direction, such as deflate.
- `points`: 2–256 `[u,v,pressure?]` samples in the returned image, normalized from 0 to 1; the origin is the top-left, u goes right and v goes down. Repeat a point for a dab.
- `radius`: fraction of image width, 0.001–0.5; `strength`: 0–1. Start gently and adjust using visual feedback.
- `symmetry`: a subset of `xyz`, with an empty string for free asymmetric work.

Example stroke, with IDs and coordinates taken from your current observation:

```json
{"action":"stroke","edit_id":"<edit_id>","view_id":"<latest_view_id>","brush":"grab","points":[[0.5,0.5,1],[0.54,0.48,1]],"radius":0.08,"strength":0.3}
```

Call `blender_view` with `edit_id` to observe or change views: `preset` (front/back/left/right/top/bottom), `orbit: [yaw,pitch]` in degrees, `zoom`, `pan: [right,up]`, `frame`, `rotation: [w,x,y,z]` or `projection` (ORTHO/PERSP). Use the latest returned view_id for each following stroke. `highlight: false` restores scene viewport appearance. `isolate: true` shows and hit-tests only the target, and `false` restores context. `probe_points: [[u,v], ...]` reports what each image point hits, including occluders, without editing the mesh.

`undo` and `redo` revisit stroke boundaries while preserving the current viewing angle. The latest 64 boundaries are retained. In the shared scene, `commit` leaves brush mode while preserving the geometry and live scene; an optional `save_path` creates a separate snapshot. `discard` returns to the state at entry to the current brush trial. Code can continue modifying the same live geometry and returns to Object Mode; a later `begin` selects the next brush target. Brush operations update the working recovery file. The legacy isolated interface saves a new file and closes its editing process at commit.

Each conversation owns its scene. Shared images, journals and recovery are stored in `.dsh-blender/scenes/<scene_id>/`; legacy isolated edits use `.dsh-blender/sculpt/<edit_id>/`. Idle sessions save and exit after 30 minutes by default. A desktop graphics context and Blender Essentials brush assets are required.

## Continue editing

In the shared workspace, code and brushes continue on the current live geometry. A commit leaves brush mode; the returned brush_base_path identifies the state at entry for later restoration. Save a separate project snapshot with blender_scene when useful. Opening a saved scene or restored checkpoint selects another starting point. Symmetry defaults to an empty string; choose it according to the reference and region.

The optional legacy interface publishes saved_path on commit; use that file as blend_path for subsequent file-based Python or isolated brush edits.
