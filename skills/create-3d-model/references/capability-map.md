# Capability map

## Contents

1. Loading rule
2. Orchestration and production
3. Core Blender domains
4. Reference-locked reconstruction
5. Motion and animation QA

## Loading rule

These 29 legacy modules are optional technical references. With registerModuleSkills:true they can be loaded through the skill tool; otherwise their files remain readable as project resources. With exposeLegacyTools:true, blender_helper_catalog returns a compact index; query a helper name for its exact arguments. Choose relevant material according to the current evidence and method.

## Orchestration and production

| Module | Load it when |
| --- | --- |
| `blender-pro-workflow` | The request spans multiple stages or needs a complete scene, hero shot, critique loop, or production order. |
| `blender-skill-harmonizer` | Multiple modules must share source-of-truth, handoff, precedence, or repair decisions. |
| `quality-refinement-autoloop` | A result is repeatedly subpar and evidence must be converted into a repair plan. Do not perform its skill/release mutations without an explicit request. |
| `mascot-logo-reconstruction` | A brand mascot, logo, flat character, or emblem must be reconstructed through fail-gated source matching. |

Use `create-3d-model` for the shared tool and review contract. The modules below are optional technique references; select them according to the task.

## Core Blender domains

| Module | Capability |
| --- | --- |
| `blender-modeling` | Native sculpt brushes, primitives, mesh edits, curves, modifiers, `bmesh`, topology and structural validation. |
| `blender-materials` | Principled PBR, metal, glass, plastic, fabric, skin/wax, procedural wood/marble/weave, and Blender 5 socket compatibility. |
| `blender-lighting` | Subject-aware three-point, studio, cinematic, practical, HDRI, outdoor, color-temperature, and shadow setups. |
| `blender-cameras` | Focal length, composition, depth of field, tracking, orbit, dolly, push-in, and animated camera work. |
| `blender-rendering` | Cycles/EEVEE selection, samples, denoise, light paths, color management, stills, image sequences, and video output. |
| `blender-animation` | Keyframes, easing, F-curves, Blender 5 layered Actions, shape keys, drivers, NLA, and loops. |
| `blender-export` | glTF/GLB, FBX, OBJ, USD, STL, target axes, texture packaging, decimation, and export validation. |
| `blender-uv-texturing` | UV unwrap/projection, atlases, alpha decals, baking, lightmaps, and glTF-ready textures. |
| `wireframe-to-3d` | OpenCV line extraction, Bezier fitting, Blender curve/mesh construction, paired-part checks, and GLB delivery. |

## Reference-locked reconstruction

Load these only when source fidelity matters more than plausible freeform modeling.

| Module | Capability |
| --- | --- |
| `reference-to-3d` | Overall source/template/orthographic/texture-driven reconstruction workflow. |
| `reference-analysis-validator` | Source manifests, masks, connected components, overlays, IoU/SSIM, bboxes, centroids, and fail-before-export gates. |
| `source-part-segmentation` | Separate touching or overlapping source parts into structural masks. |
| `contour-to-mesh` | Turn masks/contours into filled mesh surfaces or shallow extrusions. |
| `orthographic-registration` | Register front/side/back/top views into a shared coordinate contract. |
| `multiview-constraint-solver` | Detect contradictory orthographic sources and choose a canonical policy before rebuilding. |
| `atlas-uv-fitting` | Detect atlas regions and map individual parts into their intended UV rectangles or projections. |
| `closed-surface-uv-coverage` | Gate texture coverage across front cap, back cap, and sidewalls of closed/extruded assets. |
| `texture-driven-mesh-fitting` | Fit mesh boundaries to a texture or source contour instead of stretching the texture over an approximate mesh. |
| `landmark-fit-repair` | Measure and repair named feature points beyond coarse bbox or silhouette metrics. |
| `multiview-fit-loop` | Render, compare, adjust, and repeat across registered views. |
| `fit-repair-optimizer` | Convert validation failures into dependency-aware repair queues. |
| `reference-look-calibration` | Match crop, extent, brightness, saturation, hue, glow, materials, lights, and render settings to source imagery. |

## Motion and animation QA

| Module | Capability |
| --- | --- |
| `texture-state-animation` | Registered, layered, export-aware transitions between texture/material states without whole-image popping or ugly crossfades. |
| `orbital-hud-motion` | Source-derived halo, orbit, dot, dash, scanner, parallax, and restrained HUD motion. |
| `animation-quality-gate` | Contact-sheet validation for flicker, silhouette stability, framing, subject dominance, layer separation, and export truth. |
