# Native brush editing

Native brushes shape mesh silhouettes, proportions, soft volumes, flowing forms, folds and surface transitions through direct image feedback. They apply throughout construction, from developing a rough component to reshaping an established form and refining a region. Grab and Elastic Grab move regions, Draw/Inflate/Clay develop volume, Crease/Pinch define folds and transitions, and Smooth blends the surface. Code and brushes edit the same scene and can alternate as the geometry develops.

## Editing contract

Choose a visible mesh with enough vertices in the region you want to shape. For a sparse mesh, add actual base-mesh subdivisions with Python first; inspect its current modifiers before applying topology changes. This bridge edits fixed-topology base meshes. Apply or remove Multires, use a base mesh with Shape Keys resolved, and keep Dynamic Topology disabled at entry. In the shared scene, call `blender_sculpt` with `action: "begin"`, `object_name` and an optional `preset` such as `front`. The scene remains the one used by `blender_execute`. The legacy file interface also accepts `blend_path`.

Entry opens a viewport framed on the selected component and returns its image immediately. The target is orange and context is gray; these temporary display colors preserve actual materials. `view.target.screen_bounds` gives the projected box, and `surface_samples` give raycast-confirmed target points with world locations and normals. These points are possible aiming locations; choose strokes according to the intended shape. Each stroke also returns an updated image; the observations needed for brushing are included in those tool results. Keep its `edit_id` and latest `view_id`. During editing, each `stroke` returns a new image and updated geometry evidence. Continue applying strokes and observing their effect for as long as useful.

- `brushes` discovers installed Essentials assets with `query`, `offset` and `limit`; use an exact returned name such as `Pose`, `Boundary`, `Mask` or a Cloth/Face Sets variant. The aliases `draw`, `grab`, `smooth`, `inflate`, `clay`, `clay_strips`, `draw_sharp`, `crease`, `pinch`, `flatten`, `scrape`, `elastic_grab`, `snake_hook`, `layer` remain available. An omitted `brush` retains the active native brush. Set `invert: true` for the opposite direction, such as deflate.
- `points`: 2–256 `[u,v,pressure?]` samples in the returned image, normalized from 0 to 1; the origin is the top-left, u goes right and v goes down. Repeat a point for a dab. Start on the selected visible surface. Native drag brushes can continue beyond the silhouette; their complete mouse path is replayed.
- `radius`: nominal radius as a fraction of image width, 0.001–0.5; `strength`: 0–1. The bridge writes the effective native owner, including unified settings, and adapts radius/diameter across Blender versions. Radius selects VIEW units. Omitted values retain the current native settings. `editor.brush` reports effective radius, source, strength, falloff, pressure and stroke method. `displacement` reports moved vertices and local-space distances; `attributes_changed` captures Mask and Face Sets edits.
- `symmetry`: a subset of `xyz`, with an empty string for asymmetric work. Omitted symmetry retains the current native axes.

Example stroke, with IDs and coordinates taken from your current observation:

```json
{"action":"stroke","edit_id":"<edit_id>","view_id":"<latest_view_id>","brush":"grab","points":[[0.5,0.5,1],[0.54,0.48,1]],"radius":0.08,"strength":0.3}
```

Call `blender_view` with `edit_id` to observe or change views: `preset` (front/back/left/right/top/bottom), `orbit: [yaw,pitch]` in degrees, `zoom`, `pan: [right,up]`, `frame`, `rotation: [w,x,y,z]` or `projection` (ORTHO/PERSP). Use the latest returned view_id for each following stroke. `highlight: false` restores scene viewport appearance. `isolate: true` shows and hit-tests only the target, and `false` restores context. `probe_points: [[u,v], ...]` reports what each image point hits, including occluders, without editing the mesh.

`undo` and `redo` revisit stroke boundaries while preserving the current viewing angle. The latest 64 boundaries are retained. In the shared scene, `commit` leaves brush mode while preserving the geometry and live scene; an optional `save_path` creates a separate snapshot. `discard` returns to the state at entry to the current brush trial. Code can continue modifying the same live geometry in its current native mode. `blender_execute(mode="OBJECT", ...)` or `blender_scene(action="configure",mode="OBJECT")` explicitly changes modes. Read-only code queries preserve the current stroke history. Python geometry edits or context switches start a new stroke-history segment; the brush-entry snapshot remains available to discard the trial. Brush operations update the working recovery file. The legacy isolated interface saves a new file and closes its editing process at commit.

Each conversation owns its scene. Shared images, journals and recovery are stored in `.dsh-blender/scenes/<scene_id>/`; legacy isolated edits use `.dsh-blender/sculpt/<edit_id>/`. Idle sessions save and exit after 30 minutes by default. A desktop graphics context and Blender Essentials brush assets are required.

## Continue editing

In the shared workspace, code and brushes continue on the current live geometry. A commit leaves brush mode; the returned brush_base_path identifies the state at entry for later restoration. Save a separate project snapshot with blender_scene when useful. Opening a saved scene or restored checkpoint selects another starting point. Current native symmetry is retained; choose axes according to the reference and region.

The optional legacy interface publishes saved_path on commit; use that file as blend_path for subsequent file-based Python or isolated brush edits.

## Native settings and context

`blender_sculpt({action:"settings",query:"falloff",group:"brush"})` discovers matching native RNA properties with current values, types, enum choices and bounds. Groups are `brush`, `sculpt`, `unified` and, when available, `automasking`. Results are paginated and discovery returns text by default. `configure` applies a property patch, and subsequent strokes retain the values. Example:

```json
{"action":"configure","brush":"Grab","radius":0.16,"strength":0.7,"symmetry":"","settings":{"brush":{"falloff_shape":"PROJECTED","use_frontface":true}}}
```

`editor` reads Blender's current object, mode, selection, workspace tool, brush, symmetry, masks and Face Sets. Changes made through Python or the GUI appear in later tool results. More complex native data, such as custom falloff curves, are editable through Python in the same context. Brush/parameter discovery exposes the installed API; individual assets still carry Blender's own geometry, topology and stroke-method prerequisites. The bridge's currently verified brush geometry is a prepared fixed-topology base mesh.

## Aiming and feedback

`preview` takes the latest `view_id` and `points` and observes the currently configured brush. Its image marks target hits in green, other objects/background in red, the path in yellow and the nominal starting radius in cyan. Configure brush/settings first when desired; preview preserves geometry, settings and undo depth. The footprint describes geometric aiming before pressure, falloff, symmetry and automasking are applied. Use preview whenever it helps resolve placement or scale.

A `stroke` returns the full current viewport and a separate same-view before/after detail panel. The left panel is before, the right is after; both use the same recorded `crop_normalized` rectangle and image scale. Subsequent gestures use the full viewport's coordinates and latest `view_id`. `displacement.world` reports scene-unit motion; `mean_screen_delta` uses normalized right/down coordinates. `effect` distinguishes geometry, attributes and no change. These measurements describe execution; judge the intended form from the images and task.

`blender_view` accepts native `shading` fields, for example `{"light":"FLAT","show_shadows":false,"show_cavity":false}`. Results identify effective viewport lighting/cavity and the separate camera render engine/color settings. `probe_points` returns an annotated image and visible-surface hits. The target highlight is a temporary observation color.

An observation failure after a successful edit returns the operation's evidence and `observation_error`; `blender_view` refreshes the image. Stable `request_id` retries preserve completed edits. Geometry or viewpoint changes invalidate old aiming IDs, including strokes requested with `observe:false`.
