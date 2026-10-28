# Editable replay recipe

Copy `build.mjs` into the task workspace's `tools/` directory and select **DSH 3D 代码建模**. Execute this `run_code` body:

```javascript
const { pathToFileURL } = await import('node:url');
const recipe = await import(pathToFileURL(process.cwd() + '/tools/build.mjs').href);
return await recipe.run(tools, { strength: 0.6 });
```

The example creates a sphere, projects an object-local point, applies a native brush, emits before/after feedback, and saves Blender and GLB outputs. Edit the module or change `strength` to `0.3`, then rerun the same loader. Each execution starts a new scene and writes `model.blend` and `model.glb` in the workspace. The host starts a fresh code process and loads the current module source on every run.

Programs can use every authorized tool through `tools.*`; each tool retains its existing arguments and behavior. Direct Python geometry operations and native brush operations can occur in any order supported by the current scene. See the [replay contract](../../skills/create-3d-model/references/code-replay.md) for scene lifetime, targeting, image feedback and failure boundaries.
