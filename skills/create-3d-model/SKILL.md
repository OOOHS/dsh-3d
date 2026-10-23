---
name: create-3d-model
description: Create and refine editable Blender models from text or images, using native geometry tools, brushes and code with visual feedback.
---

# Blender modeling and reconstruction

Build editable three-dimensional geometry faithful to the user's reference and requested quality. Choose and revise your own methods, work order and component boundaries as you learn from the scene. Native mesh editing, brushes, curves, modifiers, Geometry Nodes and Python can be combined throughout modeling.

Use iterations to explore materially different methods or work orders as well as refine a candidate. A persistent discrepancy is useful evidence for reconsidering the representation or approach. Choose the scope and timing of trials yourself; existing components can be reused across alternatives. Keep useful candidates and observations so you can compare approaches and return to a better version.

## Available capabilities

- `blender_status` describes the local Blender runtime. `blender_scene_info` and `blender_object_info` reveal names, transforms, bounds, topology and materials.
- `blender_python` edits any supplied `blend_path` with bpy/bmesh, or starts a new scene when that input is omitted. Saved mesh data remains editable after sculpting. Choose an earlier candidate or the current scene according to your intended edit.
- `blender_sculpt` opens a saved component and returns its highlighted viewport, projected bounds and confirmed surface points. Native brushes support direct contour, volume and surface changes. You can enter at any useful point, continue strokes, undo/redo, save a candidate with `commit` or abandon a trial with `discard`. `blender_view` controls the view, isolation, highlighting and coordinate probes. Read [sculpting.md](references/sculpting.md) for coordinates and actual mesh prerequisites.
- `blender_checkpoint` saves candidates with optional method notes, parent links and comparison images. `list`/`get` recover them; `restore` opens any candidate into a working file. Ordinary versioned files and project notes are also available. Choose how to organize your exploration.
- `blender_preview`, `blender_render` and `inspect_image` provide views and local crops for comparing shape, placement and appearance. Preserve comparable viewpoints where useful and inspect other angles to understand three-dimensional structure.
- `web_search` and `web_fetch` can supply Blender knowledge and supplementary references. Keep the user's reference as the primary target, record useful sources and distinguish visible evidence from inferred geometry.

Tool details and optional analysis helpers are described in [dsh-integration.md](references/dsh-integration.md). Legacy modules provide optional technical references. Verified techniques and observations can be retained in project notes for later decisions.

## Acceptance and delivery

For image reconstruction, copy the reference into the workspace and register it with `review_reconstruction({action: "begin", reference_path: "..."})`. An optional `blend_path` selects an existing candidate. Workspaces scope tool paths and preserve original inputs.

Apply a high standard to visual fidelity and craftsmanship. Use review feedback as evidence for your next decision: refinement, another method, a different work order or a return to a saved candidate. Each review uses a fresh independent agent. Final acceptance requires an `approved: true` report matching the selected saved `.blend` and its genuine comparable renders. Review timing during exploration is yours. The runtime preserves checkpoints and provides bounded context recovery; a paused or unavailable task retains its incomplete acceptance state.

Deliver the chosen editable `.blend`, requested export (`.glb` by default), inspected renders and review report. Describe remaining uncertainty and unfinished work accurately.
