---
name: create-3d-model
description: Create and refine editable Blender models from text or images. Use for 3D reconstruction, native sculpting, mesh edits, materials, rendering and export.
---

# Blender modeling and reconstruction

Produce editable three-dimensional geometry faithful to the user's reference and requested quality. Choose and combine native Blender techniques freely: mesh editing, brushes, curves, modifiers, Geometry Nodes and Python.

## Working with the tools

- Inspect the reference and call `blender_status` before modeling. Copy external reference files into the workspace for the workspace-scoped tools, preserving originals.
- Use native brushes when they can improve shape. When programming leaves a visible problem unresolved, or repeated parameter edits make little progress, consider `blender_sculpt` for a more direct local correction. Brush work is useful for primary forms and refinement, with immediate visual feedback and undo.
- `blender_sculpt` keeps an editing session open across strokes; `blender_view` returns the current image and controls the view. Prepare adequate base-mesh density and commit or discard before returning to file-based tools. Read [sculpting.md](references/sculpting.md) for coordinates and examples.
- Inspect rendered images, preserve useful viewpoints across iterations, and save versioned `.blend` checkpoints. Let the visible result guide technique changes.
- Read [dsh-integration.md](references/dsh-integration.md) when tool details are useful. The helper catalog provides optional reference-analysis utilities.

## References and learning

- Use `web_search` and `web_fetch` when additional visual references or Blender knowledge would help. Check that supplementary images depict the same subject and version; record source URLs and distinguish observed details from inferred geometry. Keep the user's image as the primary visual target.
- Preserve successful techniques and verified findings in concise project notes with evidence. Reusable lessons can become skills after practical validation.

## Completion

Apply a high standard to fidelity and overall visual quality. Submit the current saved `.blend` and genuine comparable model renders to `review_reconstruction`. Completion requires a successful `approved: true` report bound to these current artifacts. Use review feedback to improve the result and submit changed artifacts for a fresh review.

Deliver the editable `.blend`, requested export (`.glb` by default), inspected renders and review report. State remaining uncertainty and report incomplete work accurately. Keep original inputs and unrelated user scene data preserved.
