---
name: mascot-logo-reconstruction
description: Orchestrate a fail-gated, source-locked Blender reconstruction of mascots, logos, brand avatars, and stylized flat characters from wireframes, texture packs, and orthographic views. Use when the user requires a 1:1 brand/model match rather than a plausible stylized interpretation.
when_to_use: Brand mascot/logo 3D reconstruction, exact part counts, texture-driven model matching, repeated “does not match reference” feedback, or full pipeline coordination across analysis, contour mesh, registration, UV fitting, validation, animation, and export.
allowed-tools: Read Bash Glob Grep blender_python blender_scene_info blender_scene_info
---

# Mascot / Logo Reconstruction

Reconstruct designed characters, mascots and logos from the supplied artwork. Preserve their identifying silhouette, proportions, expression, hair/clothing, colors and appendages. Read actual occlusion and asymmetry from the source.

## Native modeling choices

For volumetric characters, choose mesh construction, native sculpting, curves, modifiers and Python as useful. Brush edits can establish primary forms and refine secondary detail. For flat designed elements, contour meshes and shallow extrusions are available options. Prepare sufficient topology and inspect alternate views for volume, connections and thickness.

Optional segmentation, landmarks, registration, contour and UV helpers can support particular inputs. Use atlas tools when a texture pack exists; select related skills as references when needed. Modeling and repair choices follow visible evidence and the reconstruction goal.

## Acceptance

Keep editable model versions, genuine reference-aligned and alternate renders, and an independent `review_reconstruction` report. The current final artifacts require `approved: true` before completion. Use concrete reviewer differences to guide the next edit; rerender and review after changes. Structural/export validation complements visual acceptance.

## Front-plane rotation rule

In this Blender coordinate convention, the front camera looks along the Y axis and the reference silhouette lives in the X/Z plane. Therefore 2D rotations inside the front view are rotations around the **Y axis**, not around Z. Use `rotation_euler = (0, angle, 0)` for 2D component orientation in the front projection. Z rotation spins objects into/out of screen-space incorrectly for X/Z-plane meshes.

## Output contract

Deliver the requested model format (GLB by default), its editable .blend, useful multi-view renders and the successful current review report. Add measurement, registration or texture reports when those techniques were used. Record genuine remaining limitations and any incomplete/rejected status.
