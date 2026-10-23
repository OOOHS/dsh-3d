# Shared scene and project tools

One native Blender process owns this conversation's working scene. Code, native brushes and observations use the same geometry. `blender_execute` automatically creates an empty scene on first use; `blender_scene({action:"open",blend_path:"..."})` loads a saved candidate. `new` explicitly selects an empty starting point. Opening a different starting point retains the previous working recovery file.

## Incremental execution

`blender_execute({script:"..."})` runs with the existing scene loaded. Globals include `bpy`, `bmesh`, `mathutils`, `workspace`, `params` and `dsh`; set JSON-safe `dsh_result` for structured output. Code executes in an Object Mode viewport context. Useful existing changes remain in the scene. Use explicit scene creation or component replacement according to your intended scope.

Every successful code operation returns a revision, working `.blend`, affected-object summary, script result and (by default) a viewport image. `observe:false` returns text evidence for queries or batched work. The runtime saves the current working file. A Python exception restores the scene from the preceding operation; diagnostics describe the failure. Project file edits remain ordinary filesystem changes.

`blender_scene({action:"inspect",object_names:["Hair"]})` gives object dimensions, topology, materials and modifier prerequisites. Python can query additional native properties. `status` returns the active scene, mode, recovery path and a compact index of `tools/*.py` files.

## Reusable code

Create ordinary Python files with the host file tools. A file can define `run(params)` or assign `dsh_result`. On every `blender_execute({tool_path:"tools/offset_component.py",params:{...}})` call, its current source is read and compiled; edits apply on the next invocation. The result records its source hash. This supports project-local observation tools, geometry helpers and action combinations.

Example tool file:

```python
"""Offset a named existing component; report its resulting location."""
def run(params):
    obj = bpy.data.objects[params["object"]]
    obj.location += mathutils.Vector(params["offset"])
    return {"object": obj.name, "location": list(obj.location)}
```

The `dsh` object exposes the native bridge inside code:

- `dsh.inspect(object_names=None, limit=40)` returns scene/object facts.
- `dsh.select(object_name, sculpt=False, **view_options)` selects and frames an object. `sculpt=True` enters native brush mode.
- `dsh.view(**options)` returns a viewport observation with view ID and target surface samples.
- `dsh.stroke(brush=..., view_id=..., points=..., radius=..., strength=...)` uses the same normalized coordinate contract as the brush tool.
- `dsh.render(output_path=..., camera=..., width=..., height=..., samples=...)` renders the current scene, with a scene/image provenance sidecar. Save camera configuration with ordinary bpy operations.

Tools can import project modules using normal Python facilities. Explicit module reloads select updated imported dependencies. Save applicable conditions, observations and alternative implementations alongside reusable code as useful.

## Views, snapshots and resources

`blender_view` uses the current scene when `edit_id` is omitted. `kind:"viewport"` supports axis presets, orbit, zoom, pan, isolation and probes. `kind:"render"` accepts a camera name and an optional new PNG output path. The viewport supplies stroke coordinates; camera renders supply appearance evidence.

`blender_scene({action:"save",save_path:"models/candidate.blend"})` saves a project snapshot while keeping the scene open. `blender_checkpoint` archives saved files and optional comparison images; opening any restored/saved file lets you revisit it. Working snapshots and journals live under `.dsh-blender/scenes/<scene_id>/`. `close` releases the process and retains recovery. Idle processes save and exit after the configured timeout.

The native viewport requires a desktop graphics context. Fixed-topology brushes use prepared base meshes; regular bpy operations remain available for topology changes. File-based tools and the upstream helper catalog can be enabled with `exposeLegacyTools:true`; `enableSharedScene:false` selects the legacy file-based runtime. See [dsh-integration.md](dsh-integration.md) for those compatibility interfaces.
