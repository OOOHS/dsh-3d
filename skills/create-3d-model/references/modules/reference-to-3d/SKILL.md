---
name: reference-to-3d
description: Reconstruct Blender models from supplied reference sheets, branding templates, texture atlases, orthographic front/side/back/top views, or mascot/logo art where visual fidelity to the source is more important than a plausible generated object. Use when the user says the model must match a template, wireframe, texture pack, character sheet, mascot sheet, or brand asset exactly; also use after feedback like "does not look like the reference", "fit the texture 1:1", "wrong number of visible parts", or "compare against the template". Requires the dsh Blender tools plus local Python with Pillow/OpenCV/numpy; pairs with blender-uv-texturing, wireframe-to-3d, blender-modeling, blender-materials, and blender-export.
when_to_use: User supplies reference images/templates/texture atlases/orthographic views and wants a model matching them, or repeated visual mismatch feedback requires a reference-locked corrective loop.
allowed-tools: Read Bash Glob Grep blender_python blender_scene_info blender_scene_info blender_render
---

# Reference-to-3D Reconstruction

Inspect the actual source images and reconstruct the visible subject using whichever native Blender methods suit its form: mesh editing, sculpt brushes, curves, modifiers, Geometry Nodes or Python. Match silhouette, proportion, landmarks, expression and characteristic details. Use coherent depth and hidden-surface assumptions for single-image inputs.

## Useful evidence and methods

- Read the reference first. Record important shapes, part relationships, colors and uncertainty at a level useful for the task.
- For organic shapes, prepare a suitable base mesh and use `blender_sculpt` repeatedly with `blender_view` feedback. Direct mesh edits and curve construction can complement brush work.
- For silhouettes, technical drawings or flat logo elements, optional contour extraction and `contour-to-mesh` examples can provide a starting form. Choose a suitable volume and topology for the actual subject.
- Optional local helpers include `template-analyzer` and `silhouette-validator`; discover their exact names and arguments through `blender_helper_catalog({ module: "reference-to-3d" })`. Measurements support visual inspection.
- Use orthographic registration when multiple corresponding references are supplied. Document conflicts and unseen-surface assumptions.
- Use atlas/UV helpers when the supplied inputs include a texture atlas. Use authored materials, native geometry or other appropriate methods for ordinary image references.
- Hide reference images/planes and helper overlays in acceptance renders. Render a comparable reference view and useful alternate views that reveal the actual geometry.

## Completion

Save the current editable .blend and genuine model renders, then call `review_reconstruction` with the reference, render paths/view labels and final `blend_path`. Completion requires its successful `approved: true` result for the unchanged final artifacts. Correct important reviewer differences and review again; preserve failed reports and saved progress when a real limit prevents completion. Validate requested exports separately.

## Optional Blender code examples



### Reference plane in front-view X/Z

```python
import bpy

def create_reference_plane(name, image_path, width, height, y=0.2, alpha=0.35):
    img = bpy.data.images.load(image_path, check_existing=True)
    mat = bpy.data.materials.new('MAT-' + name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = img
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    mat.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Alpha'].default_value = alpha
    mat.blend_method = 'BLEND'
    verts = [(-width/2,y,-height/2),(width/2,y,-height/2),(width/2,y,height/2),(-width/2,y,height/2)]
    mesh = bpy.data.meshes.new(name + 'Mesh')
    mesh.from_pydata(verts, [], [(0,1,2,3)])
    mesh.update()
    uv = mesh.uv_layers.new(name='UV')
    for li, uvco in zip(mesh.polygons[0].loop_indices, [(0,0),(1,0),(1,1),(0,1)]):
        uv.data[li].uv = uvco
    obj = bpy.data.objects.new('REF-' + name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj.hide_render = True
    return obj
```

### Validation print contract

```python
print('VALIDATE expected_primary_parts=', expected, 'actual=', actual)
print('VALIDATE front_locked=True reference_overlay_rendered=True')
if actual != expected:
    raise RuntimeError('Part-count mismatch; refusing export')
```

## When to stop and ask for human input

Ask for a correction only after generating evidence, e.g. an overlay image or JSON showing ambiguity. Do not ask vaguely. Example: “The analyzer finds N prominent structural components plus M faint background/decorative shapes. Should the GLB include only the structural components?”

## Sources distilled

- Blender Manual: Image Empties for reference images/blueprints; front/back display, opacity, orthographic and axis-aligned controls.
- Blender Manual: Trace Image to Grease Pencil works best from manually prepared black/white images and controlled resolution.
- Blender Manual: Shrinkwrap moves vertices to a target surface and is useful after silhouette lock for conforming secondary details.
- Blender Manual: UV/Image Texture and Project-from-View-style workflows require UV maps and material nodes for renders/exports.
- OpenCV docs: contour moments, area, perimeter, bounding boxes, template matching.
- scikit-image docs: SSIM for image similarity when pixel-MSE is not perceptually meaningful.
