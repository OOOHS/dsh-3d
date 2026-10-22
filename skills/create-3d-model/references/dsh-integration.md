# DSH 3D tool reference

The plugin registers one modeling skill by default. Its tools remain available throughout the task. Choose methods and observations according to the current modeling problem.

## Scene and geometry

- `blender_status`: Blender availability, workspace and capability information.
- `blender_scene_info` and `blender_object_info`: scene structure, exact object names, bounds, topology and materials.
- `blender_python`: native bpy/bmesh scene operations with `bpy`, `bmesh`, `mathutils`, `workspace`, `input_path` and `output_path` in scope. Retrieve objects by stable names, establish operator context and set `dsh_result` for useful structured evidence.
- `blender_sculpt` and `blender_view`: persistent native brush edits and live images; see [sculpting.md](sculpting.md).
- `blender_import`: import a supported portable model into a saved `.blend` when the task includes one.

## Images and delivery

- `blender_preview`: temporary camera/light preview from a standard axis or isometric view.
- `blender_render`: render the scene's authored camera; `blender_render_frames`: animation images.
- `review_reconstruction`: `action: "begin"` registers the reference and an optional existing `blend_path`; `action: "status"` returns the editable checkpoint and review state; `action: "review"` (default) submits current renders and the required final `blend_path` for independent visual acceptance. The plugin continues a registered task at the public stop boundary until current evidence is approved. Inspect feedback and obtain a fresh approval after changes.
- `blender_export`: save a portable model; `blender_validate_scene` and `blender_validate_export`: inspect structure and export/re-import compatibility.
- `blender_helper_catalog` and `blender_helper_run`: discover and execute optional analysis helpers with their exact arguments.

Use `read_image` to inspect saved renders. Sculpt tools return image blocks directly. Use ordinary file tools for project files and `web_search` / `web_fetch` for supplementary reference research and native Blender knowledge.

## Paths and editing state

Tool paths resolve inside the current conversation's workspace, including resolved symlinks. Copy external reference images into that workspace and keep original inputs preserved. Save durable results and versioned `.blend` files in the workspace. A sculpt session owns its live scene until commit/discard; perform ordinary file-based operations after exiting that session.

Blender Python is scoped to Blender scene data. Use the host's dedicated tools for file and web work. Each background Python call has a fresh process; saved scene data carries across calls. Error output describes the failed operation and supports a focused repair.

## Review reports

Send a comparable reference view and useful alternate views of the actual current geometry, with reference planes and guide overlays hidden. Review reports record the model route, fixed rubric, response, source/render hashes and the supplied `.blend` hash. `approved: true` from a successful report of the current final artifacts is the completion requirement. A rejected review keeps the task active. Review service errors and configured resource limits preserve a paused, incomplete task. User cancellation stops the active turn; a fresh `begin` resumes work on direct user continuation. Technical export validation complements visual acceptance.

## Current scene

Each brush commit publishes its saved scene as the current checkpoint. Continue Python edits from that file using `blend_path`. This preserves sculpted geometry while keeping programmatic editing available. The state notice is persisted in the ordinary conversation history; resumed sessions start paused and return their checkpoint through `action: "status"`.
