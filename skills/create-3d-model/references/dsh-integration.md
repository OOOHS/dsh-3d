# DSH 3D tool reference

The plugin registers one modeling skill by default. Its tools remain available throughout the task. Choose methods and observations according to the current modeling problem.

## Scene and geometry

- `blender_status`: Blender availability, workspace and capability information.
- `blender_scene_info` and `blender_object_info`: scene structure, exact object names, bounds, topology and materials.
- `blender_python`: native bpy/bmesh scene operations with `bpy`, `bmesh`, `mathutils`, `workspace`, `input_path` and `output_path` in scope. Set `blend_path` to load the current scene before code runs, retrieve objects by stable names and edit existing geometry or add components. Establish operator context and set `dsh_result` for useful structured evidence. Omit `blend_path` when creating a new scene.
- `blender_sculpt` and `blender_view`: persistent native brush edits and live images; see [sculpting.md](sculpting.md).
- `blender_import`: import a supported portable model into a saved `.blend` when the task includes one.

## Images and delivery

- `inspect_image`: observe a workspace image, crop `region: [left, top, right, bottom]` in normalized 0–1 coordinates and enlarge with `zoom: 1..4`. The returned image includes original dimensions, pixel crop coordinates and a source hash.
- `blender_preview`: temporary camera/light preview from a standard axis or isometric view.
- `blender_render`: render the scene's authored camera; `blender_render_frames`: animation images.
- `review_reconstruction`: `action: "begin"` registers the reference and an optional existing `blend_path`; `action: "status"` returns the editable checkpoint and review state; `action: "review"` (default) submits current renders and the required final `blend_path` for independent visual acceptance. The plugin continues a registered task at the public stop boundary until current evidence is approved. Inspect feedback and obtain a fresh approval after changes.
- `blender_export`: save a portable model; `blender_validate_scene` and `blender_validate_export`: inspect structure and export/re-import compatibility.
- `blender_helper_catalog` and `blender_helper_run`: discover and execute optional analysis helpers with their exact arguments.

Use `inspect_image` to inspect saved renders and compare local details. Sculpt tools return image blocks directly. Use ordinary file tools for project files and `web_search` / `web_fetch` for supplementary reference research and native Blender knowledge.

## Paths and editing state

Tool paths resolve inside the current conversation's workspace, including resolved symlinks. Copy external reference images into that workspace and keep original inputs preserved. Save durable results and versioned `.blend` files in the workspace. A sculpt session owns its live scene until commit/discard; perform ordinary file-based operations after exiting that session.

Blender Python is scoped to Blender scene data. Use the host's dedicated tools for file and web work. Each background Python call has a fresh process; saved scene data carries across calls. Error output describes the failed operation and supports a focused repair.

## Review reports

Send a comparable reference view and useful alternate views of the actual current geometry, with reference planes and guide overlays hidden. Each review creates a fresh native agent with frozen reference/render evidence, the shared `inspect_image` tool and a private `submit_review` tool. It can observe repeatedly and correct tool validation feedback before submitting. Reports record the independent role configuration, observations, archived agent events, source/render hashes and the supplied `.blend` hash; the live review agent is released after the round. `approved: true` from a successful report of the current final artifacts is the completion requirement. A rejected review keeps the task active. Repeated automatic endings with unchanged work receive one bounded context recovery, then pause with the saved checkpoint when stalled; new successful operations or scene changes reset the idle window. An unavailable assessment retains an `awaiting-review` task and allows another review attempt. Configured continuation resource limits preserve a paused, incomplete task. User cancellation stops the active turn; a fresh `begin` resumes work on direct user continuation. Technical export validation complements visual acceptance.

## Current scene

Each brush commit publishes its saved scene as the current checkpoint. Continue Python edits from that file using `blend_path`. This preserves sculpted geometry while keeping programmatic editing available. The state notice is persisted in the ordinary conversation history; resumed sessions start paused and return their checkpoint through `action: "status"`.

Saved mesh data is editable through bpy/bmesh after sculpting. Generator parameters describe an earlier construction; work with the current mesh data for incremental changes, and choose the scope of regeneration explicitly. Components can remain separate objects through generation and sculpting, then be positioned, parented, joined or otherwise assembled in the current scene.
