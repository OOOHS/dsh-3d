# Asset and file interfaces

The shared runtime is described in shared-scene.md. Asset delivery and analysis tools are available alongside it. Each file operation uses the explicit saved input path; its outputs leave the live scene active. Save the current scene to capture a snapshot. Open an imported or alternative `.blend` to make it the live scene.

## Asset delivery

- `blender_status`: Blender and analysis-runtime availability.
- `blender_import`: import GLB/glTF, FBX, OBJ, STL, USD, PLY or Collada into a clean scene saved at `save_path`. `blender_scene({action:"open",blend_path:"..."})` activates this result for editing.
- `blender_export`: export `blend_path` to a portable format selected by `output_path`; selection_only scopes the saved scene's selected objects.
- `blender_validate_scene`: structural inspection, with general, web, 3d-print and animation profiles.
- `blender_validate_export`: import a portable file in a clean process and report structure, materials/UVs and animation presence. It detects supported structural issues; compare rendered appearance as appropriate to the task.

## Observation and analysis

- `blender_scene({action:"inspect",detail:true})`: live object detail, including evaluated mesh counts, world bounds, UV/color layers, constraints, vertex groups, shape keys and animation. `evaluated:false` skips modifier evaluation. Queries report missing names and truncation.
- `blender_view`: observe the live viewport or render a scene camera. `time_frame` retains the selected time for viewport observations; renders restore the preceding time after sampling. `frame` remains the boolean viewport framing option. `transparent` overrides render background transparency for that image.
- `blender_preview`: render a saved asset with temporary camera/lighting and configurable framing.
- `blender_render_frames`: render a saved scene at `frames` or start/end/step, returning frame numbers and image paths. `inspect_image` views the images; the animation-contact-sheet helper can combine them.
- `blender_helper_catalog`: compact helper index; `helper` returns exact arguments. `blender_helper_run` executes a named helper with those arguments. Both are controlled by enableHelpers (default true). Maintenance helpers have a separate opt-in.

## Compatibility

`exposeLegacyTools:true` additionally exposes `blender_scene_info`, `blender_object_info`, `blender_python` and `blender_render` for file-based operations. `enableSharedScene:false` selects the legacy file runtime. Python availability follows enablePython. The shared runtime accepts further Blender operations through `blender_execute` and reusable project tools.
