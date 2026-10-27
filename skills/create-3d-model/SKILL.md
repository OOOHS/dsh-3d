---
name: create-3d-model
description: Build and edit Blender geometry through Python and native brushes, with visual feedback and reusable project tools in a shared live scene.
---

# Blender workspace

Develop editable Blender assets and scenes for the user's task: modeling, scene assembly, materials, lighting, animation or reference reconstruction. Python exposes Blender's broader API, including curves, modifiers, Geometry Nodes, rigging and animation; consult native documentation and construct project tools as needed. Choose your representations, methods, component boundaries, work order and exploration strategy using actual observations.

Python and native brushes are modeling interfaces to the same live geometry. Both can develop rough forms, change silhouettes and proportions, shape volumes and refine surfaces. Choose either interface or combine them according to the intended change and observed results. Their use can alternate at any point while each operation builds on the current scene.

## Code modeling and editing

Python directly creates and edits scene objects and their geometry through `bpy`, `bmesh` and `mathutils`. Its scope includes existing meshes and sculpted forms as well as new components. Select the objects, vertices, edges, faces or spatial regions you intend to affect:

- Move selected vertices or use weighted deformations to change silhouettes, proportions, bends, soft volumes, folds and asymmetry. Selection weights and falloff define the extent and transition of an edit.
- Extrude, inset, cut, bridge, merge, subdivide or remesh geometry to develop shapes and change topology. Add, remove or replace components at the scope appropriate to the current task.
- Smooth surfaces, edit modifiers, adjust object transforms, materials and relationships, or assemble existing components. Python can also invoke native brushes through `dsh.select(...,sculpt=True)`, `dsh.view()` and `dsh.stroke()`.

`blender_execute` runs in the current scene and native editing context, with existing meshes and brush edits available to the script. Mode, selection, active tool and brush settings persist; choose `mode` explicitly when an operation needs it. `blender_scene` with `action:"configure"` selects an object, enters a native mode or selects a native workspace tool, and every editing response reports the actual Blender context. Targeted operations retain geometry outside their scope. Supply a script or a workspace `tool_path`; project tool source is freshly loaded on every call. Tools can define `run(params)` and use `bpy`, `bmesh`, `mathutils`, `workspace`, `params` and `dsh`. Execution returns affected-object evidence and, by default, a viewport image. Save and revise useful observation, construction and editing tools with the ordinary file tools. See [shared-scene.md](references/shared-scene.md) for the execution contract and examples.

## Brush modeling

Brushes act on an existing mesh. Initial geometry is available through `blender_edit` standard primitives or Python in `blender_execute`. A simple initial volume is enough to start developing a form with brushes when its mesh has sufficient vertices; an established component is also a starting point. Choose when to add geometry, change topology and shape the surface as the model develops.

Native brushes directly shape existing mesh geometry through image-space gestures. Their scope includes broad silhouette and proportion changes, soft volumes, flowing shapes, folds, creases, surface transitions and asymmetry. Brush modeling can develop a rough component, reshape an established form or refine a region at any point in construction. Choose the brush and affected area from the shape change you want:

- `grab` and `elastic_grab` move and bend regions: adjust a head silhouette, bend a hair mass, spread a fin or change the drape of a garment. Brush radius controls the spatial extent of the deformation.
- `draw`, `inflate`, `clay` and `clay_strips` build or reduce volume: develop cheeks, hair fullness, fabric bulges and raised forms. Inverted strokes reverse the brush direction.
- `crease`, `draw_sharp` and `pinch` define grooves, folds and narrow transitions; `smooth`, `flatten` and `scrape` blend or level surfaces.

`blender_sculpt({action:"begin",object_name:"...",preset:"front"})` selects a mesh in the current scene and returns a framed image, target bounds and surface samples. `brushes` discovers the installed Essentials assets, including Pose, Boundary, Cloth, Mask and Face Sets variants. `settings` searches native parameters and their accepted values; `configure` activates a brush or adjusts those parameters. `stroke` uses the active brush and the latest `view_id` with normalized image points. Set radius, strength, symmetry, falloff, front-face filtering or other settings according to the intended change; omitted settings retain Blender’s current values. A drag starts on the visible target and may extend beyond its silhouette. Optional `preview` shows the configured brush footprint, intended path and visible hits while preserving geometry and settings. Each stroke returns a full viewport, a same-view before/after detail image, effective brush settings and measured geometry or attribute changes. Full viewport coordinates ground subsequent edits; detail images report their separate crop. You can keep using brushes, change views, isolate components and use undo/redo throughout the editing session. `commit` leaves brush mode with the shaped mesh retained; `discard` restores the state at entry. Select symmetry according to the intended form; the tool reports the current native axes.

The bridge shapes fixed-topology base meshes with sufficient actual vertices across the area being shaped. Brush edits remain ordinary mesh data available for further Python editing and subsequent brush sessions. See [sculpting.md](references/sculpting.md) for the coordinate contract, stroke example and mesh prerequisites.

`blender_edit` also exposes native mesh selection, proportional transforms and selected-face extrusion in the same scene. `density:"base"` preserves simple primitive topology; other densities prepare sculpt vertices. `mesh_select` uses a full-viewport rectangle or all/none and retains selection in Edit Mode. `mesh_transform` changes the selected region, with optional influence radius and falloff; `mesh_extrude` extends selected faces. These operations and brushes can alternate as the form develops.

## Scene and observation

- `blender_scene` creates/opens the working scene, inspects objects (`detail:true` adds evaluated topology, UVs, constraints and animation), saves snapshots and lists project tools. Opening a saved candidate selects another starting point.
- `blender_view` observes, changes viewpoints, isolates components and renders with a scene camera. Viewport images provide aiming coordinates for editing; camera renders show the scene's rendered appearance. `time_frame` selects animation time in the viewport or temporarily samples it for a camera render. Native `shading` controls expose lighting, shadows and cavity for observation, and results report the effective display.
- `blender_checkpoint` archives and restores saved alternatives with optional observations and method notes. `inspect_image` provides local image crops. Documentation and web search can supply additional knowledge.

Explore, compare and retain approaches as useful. Project tools, observations and experience can be revised and reused; keep their evidence and applicable conditions available. The runtime preserves the working scene and recovery files. Asset tools operate on saved snapshots: `blender_import` creates a `.blend` that `blender_scene open` can load; `blender_export` exports a saved scene; `blender_validate_scene` and `blender_validate_export` report structural and round-trip issues. `blender_preview` observes a saved asset with temporary camera/lighting. `blender_render_frames` samples animation frames; `blender_helper_catalog` discovers bundled analysis tools and `blender_helper_run` executes their structured arguments. Choose observation and checks for the task. See [dsh-integration.md](references/dsh-integration.md) for the file contracts.

For image reconstruction, copy the reference into the workspace and register it with `review_reconstruction({action:"begin",reference_path:"..."})`. Use independent review when useful; final acceptance requires approval of the selected saved scene and its genuine comparable renders. Apply a high standard to visual fidelity and craftsmanship. Deliver the editable scene, requested export, inspected renders and review report, accurately describing remaining uncertainty.


Modeling operation notes: modeling_notes_read indexes or retrieves foundation guidance on silhouette/bending, volume, smoothing, detail, mesh selection and brush aiming, plus this session’s experience. modeling_notes_write creates, revises or removes session notes with observed outcomes, evidence and applicability as useful. Choose when to consult and maintain them. New sessions start with foundation guidance; resuming this session retains its notes.
