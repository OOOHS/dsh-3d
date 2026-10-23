---
name: create-3d-model
description: Build and edit Blender geometry through Python and native brushes, with visual feedback and reusable project tools in a shared live scene.
---

# Blender workspace

Create editable three-dimensional geometry faithful to the user's reference and requested quality. Choose your representations, methods, component boundaries, work order and exploration strategy using actual observations.

Python and native brushes are modeling interfaces to the same live geometry. Both can develop rough forms, change silhouettes and proportions, shape volumes and refine surfaces. Choose either interface or combine them according to the intended change and observed results. Their use can alternate at any point while each operation builds on the current scene.

## Code modeling and editing

Python directly creates and edits scene objects and their geometry through `bpy`, `bmesh` and `mathutils`. Its scope includes existing meshes and sculpted forms as well as new components. Select the objects, vertices, edges, faces or spatial regions you intend to affect:

- Move selected vertices or use weighted deformations to change silhouettes, proportions, bends, soft volumes, folds and asymmetry. Selection weights and falloff define the extent and transition of an edit.
- Extrude, inset, cut, bridge, merge, subdivide or remesh geometry to develop shapes and change topology. Add, remove or replace components at the scope appropriate to the current task.
- Smooth surfaces, edit modifiers, adjust object transforms, materials and relationships, or assemble existing components. Python can also invoke native brushes through `dsh.select(...,sculpt=True)`, `dsh.view()` and `dsh.stroke()`.

`blender_execute` runs in the current scene, with existing meshes and brush edits available to the script. Targeted operations retain geometry outside their scope. Supply a script or a workspace `tool_path`; project tool source is freshly loaded on every call. Tools can define `run(params)` and use `bpy`, `bmesh`, `mathutils`, `workspace`, `params` and `dsh`. Execution returns affected-object evidence and, by default, a viewport image. Save and revise useful observation, construction and editing tools with the ordinary file tools. See [shared-scene.md](references/shared-scene.md) for the execution contract and examples.

## Brush modeling

Brushes act on an existing mesh. In the current plugin, Python can create the initial geometry, such as a sphere, cube or rough component, through `blender_execute`. A simple initial volume is enough to start developing a form with brushes when its mesh has sufficient vertices; an established component is also a starting point. Choose when to add geometry, change topology and shape the surface as the model develops.

Native brushes directly shape existing mesh geometry through image-space gestures. Their scope includes broad silhouette and proportion changes, soft volumes, flowing shapes, folds, creases, surface transitions and asymmetry. Brush modeling can develop a rough component, reshape an established form or refine a region at any point in construction. Choose the brush and affected area from the shape change you want:

- `grab` and `elastic_grab` move and bend regions: adjust a head silhouette, bend a hair mass, spread a fin or change the drape of a garment. Brush radius controls the spatial extent of the deformation.
- `draw`, `inflate`, `clay` and `clay_strips` build or reduce volume: develop cheeks, hair fullness, fabric bulges and raised forms. Inverted strokes reverse the brush direction.
- `crease`, `draw_sharp` and `pinch` define grooves, folds and narrow transitions; `smooth`, `flatten` and `scrape` blend or level surfaces.

`blender_sculpt({action:"begin",object_name:"...",preset:"front"})` selects a mesh in the current scene and returns a framed image, target bounds and surface samples. `stroke` takes a brush, the latest `view_id`, normalized image points, radius and strength; each stroke returns the changed geometry and a fresh image. You can keep using brushes, change views, isolate components and use undo/redo throughout the editing session. `commit` leaves brush mode with the shaped mesh retained; `discard` restores the state at entry. Select symmetry according to the intended form; its default is asymmetric editing.

The bridge shapes fixed-topology base meshes with sufficient actual vertices across the area being shaped. Brush edits remain ordinary mesh data available for further Python editing and subsequent brush sessions. See [sculpting.md](references/sculpting.md) for the coordinate contract, stroke example and mesh prerequisites.

## Scene and observation

- `blender_scene` creates/opens the working scene, inspects objects, saves snapshots and lists project tools. Opening a saved candidate selects another starting point.
- `blender_view` observes, changes viewpoints, isolates components and renders with a scene camera. Viewport images provide aiming coordinates for brushes; camera renders show the scene's rendered appearance.
- `blender_checkpoint` archives and restores saved alternatives with optional observations and method notes. `inspect_image` provides local image crops. Documentation and web search can supply additional knowledge.

Explore, compare and retain approaches as useful. Project tools, observations and experience can be revised and reused; keep their evidence and applicable conditions available. The runtime preserves the working scene and recovery files. Optional legacy file interfaces are described in [dsh-integration.md](references/dsh-integration.md).

For image reconstruction, copy the reference into the workspace and register it with `review_reconstruction({action:"begin",reference_path:"..."})`. Use independent review when useful; final acceptance requires approval of the selected saved scene and its genuine comparable renders. Apply a high standard to visual fidelity and craftsmanship. Deliver the editable scene, requested export, inspected renders and review report, accurately describing remaining uncertainty.
