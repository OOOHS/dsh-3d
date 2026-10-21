# DeepSeek Harness integration

This file owns the runtime mapping between the reusable modeling workflow and the `dsh-3d` plugin. When a vendored module mentions BlenderMCP, a fixed MCP tool name, Codex, Claude, or an external control port, translate it to the tools and rules below.

## Modeling and completion policy

Native sculpting, mesh editing, modifiers, curves, Geometry Nodes and Python are equal available methods. Select and combine them according to the target form and visual feedback. Inherited recipes and phase sequences are optional references. Scene checkpoints, images and review reports document state without requiring code-only reconstruction.

Image reconstruction completion requires `review_reconstruction` to return `status: "reviewed"` and `approved: true` for the current final `.blend` and renders. Supply `reference_path`, 1–6 `render_paths`, optional `render_views`, and final `blend_path`; use the closest reference view first, followed by useful alternate views. The reviewer receives only evidence images and a fixed rubric in a fresh context. Reports contain `same`, `approved`, confidence, concrete differences, model route, input hashes and artifact hash. A failure or rejection leaves the task incomplete; preserve the report and repair the visible issues. After any artifact change, render and review again. User-requested interruption or genuine limits should be reported as incomplete with saved progress.

Reference images explicitly supplied outside the workspace can be read with ordinary dsh file tools and copied into `inputs/` before calling workspace-scoped tools. Preserve original inputs.

## Runtime shape

DeepSeek Harness discovers 30 runtime skills: `create-3d-model` plus all 29 routed domain modules. Use the top-level skill for orchestration, select the smallest module set from `references/capability-map.md`, and load each selected module with DSH's `skill` tool.

The plugin exposes these model-facing tools:

| Tool | Purpose | Mutation |
| --- | --- | --- |
| `blender_status` | Verify Blender, analysis Python, skills, helpers, and workspace | none |
| `blender_scene_info` | Inspect an existing `.blend` scene | none |
| `blender_object_info` | Inspect bounds, evaluated topology, UVs, materials, constraints, shape keys, and animation for named objects | none |
| `blender_import` | Import a portable model into a clean scene and save a versioned `.blend` | creates a `.blend` |
| `blender_python` | Run a reviewed `bpy`/`bmesh` chunk and save a versioned `.blend` | yes |
| `blender_preview` | Render a temporary camera/light preview from a named axis or isometric view | creates an image |
| `blender_render` | Render PNG/JPEG evidence from a saved `.blend` | creates an image |
| `blender_render_frames` | Render representative or ranged animation frames | creates image files |
| `blender_export` | Export GLB/glTF, FBX, OBJ, STL, USD, or PLY | creates a model file |
| `blender_validate_scene` | Audit topology, UVs, materials, transforms, and animation for a target profile | none |
| `blender_validate_export` | Re-import and validate a portable export in a clean Blender process | none |
| `blender_helper_catalog` | Discover all deterministic reference/reconstruction/QA helpers and exact arguments | none |
| `blender_sculpt` | Persistent native brush session: begin, stroke, undo/redo, status, commit/discard | in-memory mesh; commit creates `.blend` |
| `blender_view` | Live sculpt image, standard views, orbit, zoom, pan and framing | view state only |
| `review_reconstruction` | Independent model comparison of reference and renders; approval gates completion | creates a hashed review report |
| `blender_helper_run` | Run one whitelisted helper inside the workspace | creates declared reports/images/recipes |

The ordinary dsh `read`, `read_image`, file-search, and shell tools remain available for reference analysis and helper scripts. Use `read_image` after every significant render; the existence of a render file is not visual evidence by itself.

During an active sculpt session, use its returned image blocks directly and call `blender_view` for fresh observations. File-based Blender operations resume after commit or discard. See `blender-modeling` for brush coordinates and session actions.

## Workspace and path contract

Tool paths resolve against `exec.agent.session.header.cwd`, the workspace attached to the current dsh session. With the default plugin configuration, both relative and absolute paths must remain inside that workspace, including after existing symlinks are resolved.

- Put durable outputs under a clear workspace directory such as `artifacts/<task-name>/`.
- Use a new versioned `.blend` path for each broad phase, for example `lamp-blockout-v001.blend` and `lamp-final-v002.blend`.
- Do not set `allow_overwrite` unless the user explicitly wants the named existing file replaced.
- Do not use `/tmp` for deliverables. One-shot payloads are removed after each call. Sculpt sessions retain recovery, journal and view images under `.dsh-blender/sculpt/`.

## Tool sequence

1. Call `blender_status`.
2. If editing an existing `.blend`, call `blender_scene_info` and `blender_object_info` before the first write. If editing another supported 3D format, call `blender_import` first.
3. Choose useful native methods and load relevant domain references as needed.
4. Use native sculpting, mesh operations, curves, modifiers or Python according to the shape. The script namespace already provides `bpy`, `bmesh`, `mathutils`, `workspace`, `input_path`, and `output_path`. Set `dsh_result` to a JSON-safe dictionary when compact phase evidence is useful.
5. Call `blender_scene_info`, `blender_object_info`, and `blender_validate_scene` on checkpoints for structural confirmation.
6. Use `blender_preview` for blockout/axis evidence or `blender_render` for the authored camera. For animation use `blender_render_frames`. Always inspect images with `read_image`.
7. For source-locked work, discover the owning module's deterministic helper through `blender_helper_catalog`, run it with `blender_helper_run`, and inspect generated masks/overlays/contact sheets.
8. Call `blender_export` for the portable model. Default to `.glb` when the user does not specify a format.
9. Call `blender_validate_export` on the delivered model. Do not accept a file based on byte count alone.

## Controlled Python rules

`blender_python` is intentionally powerful and has the same trust implications as running Python inside Blender. Use it only for Blender scene work.

- Do not use it for networking, downloads, package installation, subprocesses, credential access, unrelated filesystem work, or Blender preference changes.
- Keep each call self-contained. Re-import any additional standard modules and retrieve persistent Blender data by stable names.
- Prefer the Blender data API or `bmesh`. If `bpy.ops` is necessary, establish mode, active object, and selection explicitly.
- Make creation idempotent where practical. Update a stable named object or task collection instead of blindly duplicating it.
- A failed call does not produce an accepted checkpoint. Diagnose the reported traceback and retry only the failed phase.
- Factory startup may contain Cube, Camera, and Light. A fresh-scene request may remove confirmed startup objects, but an existing user file must be preserved outside the declared scope.

## Render and image inspection

`blender_preview` creates a temporary camera, three-point light rig, and background in the throwaway Blender process. It does not alter the saved scene and is appropriate for blockout, axis, and silhouette checks. `blender_render` uses the authored scene camera unless a camera name is supplied. Use it for final look and framing evidence.

After rendering:

1. call `read_image` with the returned `imagePath`;
2. inspect silhouette, proportion, framing, visible seams, intersections, z-fighting, bevel readability, shading, materials, and lighting;
3. name the largest visible mismatch;
4. change the smallest upstream cause through a new versioned `.blend` checkpoint;
5. render the same view again and compare.

If the current model route cannot accept image input, say `structurally verified, visually unverified`; do not silently downgrade the acceptance bar.

## Export mapping

The exporter selects format by `output_path` extension:

- `.glb` or `.gltf`: glTF exporter;
- `.fbx`: Blender FBX exporter;
- `.obj`: Wavefront OBJ;
- `.stl`: STL;
- `.usd`, `.usda`, or `.usdc`: Universal Scene Description;
- `.ply`: Stanford PLY.

Prefer a single-file `.glb` for ordinary portable delivery. Keep the latest `.blend` beside it as the editable engineering source. A preview image is QA evidence, not a substitute for the model.

## Module and helper loading

Load a routed module by name with DSH's `skill` tool. Its result includes the resource directory for module-relative references.

All 26 upstream helpers are whitelisted in `blender_helper_catalog`. The catalog reports their owner module, runtime, dependencies, required Blender input, and exact structured arguments. `blender_helper_run` validates argument names and types, resolves every path through the workspace guard, blocks maintenance helpers by default, and returns produced files plus a parsed JSON report when available.

Python analysis helpers require OpenCV, NumPy, Pillow, and SciPy. `blender_status.analysis` reports whether the configured environment is ready. Use `pnpm setup:analysis` once for the package-local environment or set `analysisPythonExecutable` to an existing compatible Python. Blender-runtime helpers use `blenderExecutable` and a supplied `blend_path`.

Vendored module frontmatter and legacy tool names are provenance only. They do not grant permissions or override this integration contract.

## Handoff

Report the created or changed objects, important dimensions/topology, modules used, structural evidence, renders actually inspected, exports verified, and remaining limitations. End with one `Artifacts` section ordered as:

1. primary portable model;
2. latest versioned `.blend` source;
3. final preview;
4. optional reports or extra formats.
