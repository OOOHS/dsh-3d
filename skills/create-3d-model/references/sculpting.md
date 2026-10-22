# Native brush editing

Use brushes for direct local shaping and for forms that remain awkward after scripted adjustments. Combine brushes with other native Blender methods as useful.

## Editing contract

Prepare a visible mesh with sufficient base-mesh density. The bridge supports fixed-topology meshes; prepare topology, Multires, Shape Keys and Dynamic Topology as a separate operation before entry. Call `blender_sculpt` with `action: "begin"`, `blend_path`, `object_name` and an optional `preset` such as `front`.

The returned image is the current viewport. Keep its `edit_id` and latest `view_id`. During editing, each `stroke` returns a new image and updated geometry evidence. Continue applying strokes and observing their effect for as long as useful.

- Brush choices: `draw`, `grab`, `smooth`, `inflate`. Set `invert: true` for the opposite direction, such as deflate.
- `points`: 2–256 `[u,v,pressure?]` samples in the returned image, normalized from 0 to 1; the origin is the top-left, u goes right and v goes down. Repeat a point for a dab.
- `radius`: fraction of image width, 0.001–0.5; `strength`: 0–1. Start gently and adjust using visual feedback.
- `symmetry`: a subset of `xyz`, with an empty string for free asymmetric work.

Example stroke, with IDs and coordinates taken from your current observation:

```json
{"action":"stroke","edit_id":"<edit_id>","view_id":"<latest_view_id>","brush":"grab","points":[[0.5,0.5,1],[0.54,0.48,1]],"radius":0.08,"strength":0.3}
```

Call `blender_view` with `edit_id` to observe or change views: `preset` (front/back/left/right/top/bottom), `orbit: [yaw,pitch]` in degrees, `zoom`, `pan: [right,up]`, `frame`, `rotation: [w,x,y,z]` or `projection` (ORTHO/PERSP). Use the latest returned view_id for each following stroke.

`undo` and `redo` revisit stroke boundaries while preserving the current viewing angle. The latest 64 boundaries are retained. Exit with `action: "commit"` and a new `save_path` to save the edited `.blend`, or `action: "discard"` to keep the source. File-based Blender tools resume after exit.

Each conversation owns its session. Images, the journal and periodic recovery files are stored in `.dsh-blender/sculpt/<edit_id>/`. Idle sessions expire after 30 minutes by default. A desktop graphics context and Blender Essentials brush assets are required.

## Continue editing the saved scene

A commit makes its returned `saved_path` the current editable checkpoint. Subsequent `blender_python` calls use this path as `blend_path` and save a new version. Keep working from the latest returned scene so brush shaping and later code changes accumulate together. Read the current checkpoint through `review_reconstruction({action: "status"})` when resuming. Symmetry defaults to an empty string; choose it according to the reference and the specific region.
