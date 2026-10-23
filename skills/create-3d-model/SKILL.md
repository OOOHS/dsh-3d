---
name: create-3d-model
description: Create and refine editable Blender geometry with a shared live scene, visual feedback, native brushes, Python and your own reusable tools.
---

# Blender workspace

Create editable three-dimensional geometry faithful to the user's reference and requested quality. Choose your representations, methods, component boundaries, work order and exploration strategy using actual observations.

- `blender_scene` creates/opens the working scene, inspects objects, saves snapshots and lists project tools. Opening a saved candidate selects another starting point.
- `blender_execute` runs Python in that same scene. Existing geometry and brush changes persist. Supply a script or a workspace `tool_path`; project tool source is freshly loaded on every call. Tools can define `run(params)` and use `bpy`, `bmesh`, `mathutils`, `workspace` and `dsh`. Save and revise useful tools with the ordinary file tools. See [shared-scene.md](references/shared-scene.md) for the execution contract and examples.
- `blender_sculpt` selects a component and applies native brushes in the same scene. `blender_view` observes, changes viewpoints, isolates components and renders with a scene camera. Brush coordinates and mesh prerequisites are in [sculpting.md](references/sculpting.md).
- `blender_checkpoint` archives and restores saved alternatives with optional observations and method notes. `inspect_image` provides local image crops. Documentation and web search can supply additional knowledge.

Explore, compare and retain approaches as useful. Project tools, observations and experience can be revised and reused; keep their evidence and applicable conditions available. The runtime preserves the working scene and recovery files. Optional legacy file interfaces are described in [dsh-integration.md](references/dsh-integration.md).

For image reconstruction, copy the reference into the workspace and register it with `review_reconstruction({action:"begin",reference_path:"..."})`. Use independent review when useful; final acceptance requires approval of the selected saved scene and its genuine comparable renders. Apply a high standard to visual fidelity and craftsmanship. Deliver the editable scene, requested export, inspected renders and review report, accurately describing remaining uncertainty.
