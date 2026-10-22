---
name: create-3d-model
description: Create and refine editable Blender models from text or images. Use for 3D reconstruction, native sculpting, mesh edits, materials, rendering and export.
---

# Blender modeling and reconstruction

Produce editable three-dimensional geometry faithful to the user's reference and requested quality. Choose and combine native Blender techniques freely: mesh editing, brushes, curves, modifiers, Geometry Nodes and Python.

Maintain a current editable scene throughout the task. Apply code and brush edits to that scene, preserving useful existing geometry and local shaping. Keep components independently addressable when useful; create, shape and assemble them as the model develops. Choose the scope of regeneration deliberately.

## Working with the tools

- Inspect the reference and call `blender_status` before modeling. Copy external reference files into the workspace for the workspace-scoped tools, preserving originals.
- For image reconstruction, register the workspace reference with `review_reconstruction({action: "begin", reference_path: "..."})` before modeling. Supply `blend_path` when continuing an existing scene. Use `action: "status"` to recover the current checkpoint and acceptance state.
- Choose methods by the current shape problem. Code supports precise construction, topology and assembly; brushes support direct local contours, soft volume and irregular organic forms. When a visible defect persists across edits, reassess the method and the geometry representation.
- Observe corresponding sides separately and preserve the reference's differences in contour, flow, pose, layering and occlusion. Shape each region according to its visible evidence.
- `blender_sculpt({action: "begin", blend_path: "...", object_name: "..."})` opens a component and immediately returns its viewport image; each stroke returns fresh image feedback. Use Grab for contour changes, Draw/Inflate for volume and Smooth for surface shaping, with undo/discard available while exploring. `blender_view` adds optional viewpoints. Read [sculpting.md](references/sculpting.md) for mesh preparation and coordinates; commit before continuing file-based edits.
- Continue Python edits with `blend_path` set to the current `.blend`; the tool loads its existing objects and sculpted meshes before running code. A brush commit saves an intermediate scene that can receive further code edits or another brush session, including edits to other components.
- Use `inspect_image` for full images and normalized region crops with zoom. Inspect rendered images, preserve useful viewpoints across iterations, and save versioned `.blend` checkpoints. Let the visible result guide technique changes.
- Read [dsh-integration.md](references/dsh-integration.md) when tool details are useful. The helper catalog provides optional reference-analysis utilities.

## References and learning

- Use `web_search` and `web_fetch` when additional visual references or Blender knowledge would help. Check that supplementary images depict the same subject and version; record source URLs and distinguish observed details from inferred geometry. Keep the user's image as the primary visual target.
- Preserve successful techniques and verified findings in concise project notes with evidence. Reusable lessons can become skills after practical validation.

## Completion

Apply a high standard to fidelity and overall visual quality. Submit the current saved `.blend` and genuine comparable model renders to `review_reconstruction`. The plugin keeps a registered reconstruction active until a successful `approved: true` report matches these current artifacts. Use review feedback to improve the result and submit changed artifacts for a fresh review. Each assessment uses a fresh review agent with image inspection and a structured submission tool. An `unavailable` assessment retains pending acceptance; retry the review when evidence and service are available. Runtime context recovery and a bounded stall guard support continuation. A paused task retains its checkpoint and an actionable blocker. User cancellation and configured resource limits preserve an incomplete task; resume it with `action: "begin"` when the user continues the work.

Deliver the editable `.blend`, requested export (`.glb` by default), inspected renders and review report. State remaining uncertainty and report incomplete work accurately. Keep original inputs and unrelated user scene data preserved.
