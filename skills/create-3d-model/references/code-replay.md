# Code replay

Select **DSH 3D 代码建模** (`dsh-3d-code-modeler`) to expose the host's `run_code` and generated tool SDK. The host must supply `ptcRuntime` (current dsh) or `codeRuntime` (older dsh). Every tool visible to this agent becomes an async `tools.name(arguments)` binding, including file/skill tools and the plugin's scene, brush, export, validation, review and operation-note tools. Schemas, authorization, tool logs, cancellation and image attachments use the existing host pipeline. Consult the generated SDK for exact arguments and runtime limits.

## A complete editable recipe

This is the body of a `run_code` program. It intentionally starts a new scene. Change `strength`, the primitive or any step, then rerun the recipe to regenerate the asset with the brush step included. Object names resolve against the scene created by the program.

```typescript
const strength = 0.6;
await tools.blender_scene({action: "new"});
await tools.blender_edit({
  action: "create", primitive: "sphere", name: "Volume", density: "medium"
});
const entry = await tools.blender_sculpt({
  action: "begin", object_name: "Volume", preset: "front"
});
const point = entry.view.target.surface_samples
  .map(s => s.point)
  .sort((a,b) => Math.hypot(a[0]-.5,a[1]-.5)-Math.hypot(b[0]-.5,b[1]-.5))[0];
const change = await tools.blender_sculpt({
  action: "stroke", brush: "draw", view_id: entry.view.view_id,
  points: [point, point, point], radius: .15, strength, symmetry: ""
});
await tools.blender_sculpt({action: "commit"});
await tools.blender_scene({action: "save", save_path: "model.blend", allow_overwrite: true});
await tools.blender_export({blend_path: "model.blend", output_path: "model.glb", allow_overwrite: true});
return {changed: change.changed, displacement: change.displacement};
```

The generated SDK defines canonical return values; image-bearing subcalls deliver their images after the program finishes. Use observations between program calls when the next decision depends on seeing pixels. Save reusable source in the workspace, for example `tools/build.mjs`; a later `run_code` can load a module exporting `run(tools, params)` and call it. Current Node PTC runs in a fresh process, so revised modules load on the next execution. Follow the host runtime's file policy. A program can also load a Python source through `blender_execute({tool_path:"tools/build.py",params:{...}})`.

## Native operations inside Blender Python

The following `tools/build.py` runs through `blender_execute` in the current scene. Its caller chooses a new scene, an existing scene or a saved snapshot as the starting state.

```python
def run(params):
    dsh.edit('create', primitive='sphere', name='Volume', density='medium')
    dsh.sculpt('begin', object_name='Volume', preset='front')
    dsh.sculpt('configure', brush='draw', symmetry='')
    location = dsh.project([[0, -1, 0]], object_name='Volume')[0]
    assert location['in_view'] and location['hit']['target'], location
    p = location['point']
    change = dsh.sculpt('stroke', points=[p,p,p], radius=.15,
                        strength=params.get('strength', .6))
    dsh.emit(change)
    dsh.sculpt('commit')
    return {'changed': change['changed'], 'displacement': change['displacement']}
```

- `dsh.edit(action, **options)` reuses `blender_edit` operations; Python specifies its action as the first argument. It returns operation evidence. Observe explicitly with `dsh.emit(dsh.view())` as useful.
- `dsh.sculpt(action, **options)` supports begin, brushes, settings, configure, preview, stroke, undo, redo, commit, discard and status. Arguments follow `blender_sculpt`. It returns operation evidence and observations (catalog queries return catalog data). With an omitted `view_id`, stroke/preview obtains a fresh view; supplied IDs keep the existing stale-view check.
- `dsh.project(points, object_name=None)` projects XYZ triples in world space, or object-local space when an object name is supplied. Each result includes normalized full-viewport coordinates, world coordinates, `in_view` and a visible-surface `hit`. Check `hit.target` to confirm the visible target at that pixel. Recompute projection after changing geometry or view.
- `dsh.emit(value)` returns a view/render or an operation's view and feedback as model-visible images. It accepts generated workspace PNG observations and preserves image coordinate metadata. Up to 16 images can be emitted per Python call, including with `observe:false`. It returns an image count. `dsh.view`, `dsh.render`, `dsh.select`, `dsh.stroke`, `dsh.inspect`, `dsh.configure` and `dsh.editor` remain available.

The Python adapters call existing Blender implementations in the same process. Outer `tools.*` bindings cover host-side capabilities such as export, review and session notes. These have the same arguments and effects as direct tool calls.

## Replay boundaries

Choose the starting scene explicitly for a full rebuild, and preserve the desired creation, editing and brush operations in the program. A replay regenerates the resulting geometry by executing those operations. A local edit program can instead act on the current scene. Calls affecting the same scene should use sequential `await`.

For controlled reproduction, retain the source, parameters, input assets, Blender version, brush asset/settings and view setup. Omitted brush settings inherit the current editor state. A screen-space stroke depends on its view and geometry; projecting points or computing a current selection lets code resolve a location again after earlier steps change. Check actual hit and geometry evidence. Changes to topology or occlusion can require revising the targeting code. External assets, simulations and model-based reviews can produce different results across runs.

Each program starts with fresh language variables; named Blender objects and saved files supply state for later executions. Each Python call retains its existing scene rollback on an exception. Across multiple `tools.*` calls, completed operations remain applied when a later call fails or times out. Inspect that state, resume at a chosen point or replay from an explicit starting scene. Saved `.blend` checkpoints support recovery. Review calls and operation-note writes also retain their ordinary effects; place them where useful for the task.
