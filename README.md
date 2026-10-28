# dsh-3d · DSH 3D

[简体中文](README.zh-CN.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for Blender-based 3D modeling and reconstruction from reference images.

DSH 3D is developed from [CheshireJCat/blender](https://github.com/CheshireJCat/blender) (`dsh-blender` 0.2.3, commit `9bd95e97a61096cfae1edb0f88fcd2be54b0adee`). The upstream Git history, license files, skills, tools, and analysis helpers are preserved.

## Replayable code

The **DSH 3D 代码建模** preset (`dsh-3d-code-modeler`) uses dsh's programmatic tool runtime. Every authorized tool is callable as `await tools.name(...)` inside `run_code`, covering geometry, native brushes, observation, assets, reviews and operation notes. Save and revise a complete program; replay executes its brush steps together with construction. Existing mixed and native presets retain direct tool calls.

Inside Blender Python, `dsh.edit`, `dsh.sculpt`, `dsh.project` and `dsh.emit` reuse native operations and return explicit visual feedback. Programs choose their initial scene and preserve the relevant parameters and operations. Earlier completed tool calls remain applied after a later failure. See the [code replay contract and examples](skills/create-3d-model/references/code-replay.md).

## General Blender workspace

The default modeler uses the mixed interface: Python and native controls share a live scene. Tasks can cover geometry, curves, modifiers, Geometry Nodes, materials, lighting, rigging, animation and reconstruction through Blender APIs. Native-only mode remains an explicitly selected experimental preset.

## Design principles

DSH 3D aims to give agents a broad modeling environment, useful feedback and room to improve their own methods. Three principles guide development:

### 1. Continuous improvement: GRM in the loop and reusable code

Keep a generative reviewer in the loop. The current implementation uses an independent visual review agent to compare the reference with genuine renders, explain differences and judge acceptance. The modeler can use that feedback to revise geometry, representations or methods. Each assessment starts with fresh, frozen evidence; final acceptance applies to the selected scene and its renders. Ongoing work respects user cancellation, resource limits and stalled-progress handling.

Let useful work accumulate as reusable code. Agents can create, call and modify project tools during execution, retaining useful implementations together with observations and conditions of use. Code and brush edits share a live scene, so further work can build on existing geometry. This creates two opportunities for improvement: better assets through feedback, and better working methods through reusable tools.

### 2. Tool scaling: expand the agent's range of actions

Grow the coverage, composability and discoverability of operations. Python editing, native brushes, scene inspection, view control, image crops and checkpoints give agents ways to construct, reshape, observe and revisit geometry. Python and brushes have overlapping modeling scope and can alternate throughout a task.

Keep the default entry points compact, make detailed capabilities discoverable, and let agents compose operations into their own tools. Runtime-editable project code extends the action space as the task develops. Evaluate these capabilities through actual geometry changes and visual outcomes.

### 3. Skill pruning to enable autonomous exploration

Prune prescribed workflows and redundant instructions to give the agent room to explore its own methods. Keep the main skill focused on goals, available capabilities, execution contracts and acceptance evidence. Put detailed protocols and specialist references within reach as needed. This leaves representations, component boundaries, methods, work order, experiments and candidate comparisons under the agent's control.

Review feedback and observed results guide those choices. Agents can revise their tools and approaches as they learn from the task; checkpoints preserve alternatives for comparison and recovery. The plugin supplies persistent state, feedback and room for exploration. The agent develops its working process within that environment.

## Status

The development version provides a shared live Blender workspace. Agents can alternate incremental Python, native brushes and visual observations, save alternatives, and create or revise reusable project tools during execution. Methods and work order remain agent decisions.

Current capabilities include:

- Shared editing tools: `blender_scene`, `blender_execute`, `blender_edit`, `blender_sculpt`, `blender_view` and `blender_checkpoint`; observation/review and session operation notes are also available. Scene inspection supports opt-in object details; views support animation time selection.
- Independent native DSH modeler/reviewer presets. The scoped reviewer receives observation and structured submission tools.
- One concise modeling skill by default, with native brush guidance and optional reference-analysis helpers. The 29 upstream domain skills remain available through `registerModuleSkills: true` for legacy use.
- Asset import/export, structural and round-trip validation, saved-scene preview, animation frame rendering and helper discovery are available by default. The 26 bundled helpers include maintenance utilities gated separately; discovery returns a compact index and per-helper arguments on demand. `exposeLegacyTools:true` adds duplicate file-based scene interfaces; `enableSharedScene:false` selects the legacy file runtime.

## Shared scene and reusable project tools

### Editing feedback

`blender_edit` includes persistent mesh selection, proportional transforms and selected-face extrusion, alongside object operations and sculpting. Base-density primitives retain simple topology for Edit Mode. The agent chooses which methods to combine.

Optional brush previews show the intended path, visible hits and nominal footprint. Strokes and local mesh edits return a full viewport and a same-view before/after detail image, with measured changes. Viewport shading controls expose lighting, shadows and cavity; responses identify the current display and separate render settings. See [the interface contract and validation](docs/editing-feedback.md).

## Native modeling experiment

The additional **DSH 3D 原生建模实验** preset (`dsh-3d-native-modeler`) provides a constrained action-space comparison. Modeling uses standard primitives, native sculpt gestures, object transforms, duplication and assembly. `blender_edit` adds these object controls, solid materials, mesh-density preparation, cameras and lights to the same live scene. Dense primitives are immediately sculptable; voxel remesh prepares uniform density and fuses joined overlapping volumes. Object actions retain scene checkpoints for undo/redo, including intervening sculpt work; the brush interface retains individual stroke undo.

This preset uses an agent-scoped tool allowlist enforced in presentation and dispatch. Its exposed capabilities cover native modeling, image observation, checkpoints, independent review and web reference lookup. The experiment closes arbitrary Blender Python, shell/process execution, file writes, external asset import, agent delegation and code-oriented skills. Its concise interface contract lives in `agents/native-modeler.json`; methods, work order and candidate exploration remain agent choices. The regular modeler preset continues to provide the mixed code-and-brush environment.

Compare visual quality, effective geometry changes, feedback-driven correction and resource use. Brush counts record how the agent acts within the constrained interface. Reconstruction quality remains an empirical question.

`blender_execute` edits the current scene and creates an empty scene on first use. `blender_scene` selects explicit new/open starting points, inspects object facts and saves snapshots without closing the scene. Python and native brushes operate on the same process and meshes; Python exceptions restore the preceding scene. Working files, views and journals live under `.dsh-blender/scenes/<scene_id>/`.

Agents may write ordinary `tools/*.py` files defining `run(params)`, then call them with `blender_execute({tool_path:"tools/example.py",params:{...}})`. The current source is loaded on every invocation, so edits take effect immediately. Globals include `bpy`, `bmesh`, `mathutils`, `workspace`, `params` and `dsh`; the latter exposes inspection, selection, views, native strokes and camera rendering. Outputs identify the tool source hash and actual object changes. See the [execution contract and examples](skills/create-3d-model/references/shared-scene.md).

`blender_sculpt` selects a component in the live scene. Repeated strokes, undo and views share that state. `commit` leaves brush mode and retains geometry; an optional path saves a separate snapshot. Subsequent Python continues editing this geometry. `blender_view({kind:"render"})` renders with a scene camera and records scene/image provenance.

The local development setup has exercised plugin loading, cube creation, rendering, GLB export and clean re-import, and an image-analysis helper using dsh `0.2.1-alpha.2` and Blender `5.2.2 LTS` on macOS ARM64. The historical [upstream compatibility report](docs/compatibility-v0.2.3.md) records the original project's separate validation.

## Exploring methods and candidates

The model chooses and revises its methods, work order and component boundaries. The main skill describes goals, capabilities and acceptance evidence; exploration timing, candidate count and intermediate review timing remain agent decisions.

`blender_checkpoint` provides independent `save`, `list`, `get` and `restore` operations. It archives scenes, packable resources, optional comparison images and free-form notes; `parent_id` records a candidate's origin. Any saved alternative can be restored into a working file, including earlier candidates after a sculpt commit. Final acceptance validates the selected current scene and render hashes.

Brush views highlight the target in orange, show context in gray, and return projected bounds and raycast-confirmed surface samples. `isolate` displays a component alone; `probe_points` returns hit objects, world locations and normals for image coordinates. Display colors are temporary. Brush assets and editable parameters are discovered on demand from Blender Essentials and RNA. The existing fourteen aliases remain available, alongside installed Pose, Boundary, Cloth, Mask and Face Sets variants. Native mode, selection, active tool and brush settings persist across calls. Stroke feedback includes effective radius and measured geometry/attribute changes; native drag gestures may continue beyond the silhouette. The current brush bridge still requires fixed-topology base meshes.

The shared execution interface, editable project tools and optional legacy file interfaces can all support candidate exploration. The agent chooses which scenes and observations to retain and revise.

## Installation from source

Requirements: Node.js 22.12+, pnpm, Blender on PATH or configured with an absolute path, and Python 3.10+ for image-analysis helpers.

```sh
git clone https://github.com/OOOHS/dsh-3d.git
cd dsh-3d
pnpm install --frozen-lockfile
npx @deepseek-ai/dsh@0.2.1-alpha.2 plugin --profile web add .
npx @deepseek-ai/dsh@0.2.1-alpha.2 plugin --profile web exec dsh-3d-setup
npx @deepseek-ai/dsh@0.2.1-alpha.2 web
```

The plugin appears as **DSH 3D (Development)**. Keep one version active when switching between this plugin and the original `dsh-blender`: turn off the current version, then turn on the other version.

For a custom Blender executable, add the following to your web profile's `cordis.patch.yml`, replacing the executable path:

```yaml
- id: dsh-3d
  config:
    blenderExecutable: /absolute/path/to/blender
```

Model-provider credentials belong in your dsh environment or configuration. Keep API keys and local `.env` files outside version control.

## Independent visual review

`review_reconstruction` creates a fresh native dsh agent for every assessment, receiving only the current frozen reference, 1–6 genuine renders and view labels. It can inspect regions repeatedly with `inspect_image`, then call `submit_review`. Tool validation feedback lets it repair submissions within the same round; confidence is optional metadata. Each round archives evidence, observations, a report and agent events, then releases its live agent.

`agents/modeler.json` and `agents/reviewer.json` independently define routes, reasoning effort, output budgets and role instructions. The plugin registers **DSH 3D 建模** (`dsh-3d-modeler`) and **DSH 3D 评审** (`dsh-3d-reviewer`) native presets. Choose the modeler preset for new modeling sessions. Plugin configuration can override fields through `modelerAgent` and `reviewerAgent`. Both default to `deepseek-official / deepseek-flash` with configured credentials; modeling uses high effort and review uses low. Explicit model selections in a modeling session remain effective. Reviews use their independent role configuration and normal provider billing.

A review round defaults to five minutes, 24 observation/submission steps and two transient service recoveries. These limits apply to one assessment; ongoing modeling follows host and user resource limits. Significant visible defects keep acceptance pending. Original scene/image hashes are checked before accepting the judgment.

The shared `inspect_image` accepts a workspace image path, optional normalized `region: [left, top, right, bottom]` and `zoom: 1..4`. It returns actual image pixels, original dimensions, pixel coordinates and a source hash, capped at a 2048-pixel longest side. Reviewers use admitted evidence IDs such as `reference` and `render_1`. Cropping uses the existing Python/Pillow analysis environment.

Register reconstruction with `action: "begin"` before modeling. The public DSH stop-boundary hook continues the conversation until the current scene and renders receive approval. `action: "status"` returns its current checkpoint and acceptance state; a regular review requires `blend_path`.

Example tool input:

```json
{"reference_path":"inputs/reference.jpg","render_paths":["artifacts/front.png","artifacts/side.png","artifacts/back.png"],"render_views":["reference-aligned","side","back"],"blend_path":"artifacts/model-v003.blend","report_path":"artifacts/review-v003.json"}
```

`continueUntilApproved` defaults to true. `reviewContinuationBudgetMs` defaults to 0, using the host and user limits; a positive value sets an explicit elapsed continuation budget. An assessment that exhausts its recovery budget returns `unavailable`, retains `awaiting-review` and permits another attempt. User cancellation stops the active turn. Resumed sessions retain their checkpoint in ordinary session context and wait for direct user continuation before `action: "begin"` rearms work. Earlier closing text remains in the conversation when the public hook adds another step.

Automatic endings are checked for progress using successful new tool operations and saved scene contents. Three consecutive idle endings trigger a bounded recovery and then a paused checkpoint if work remains unchanged. Status queries and repeated submissions of the same evidence preserve the idle counter. Productive work resets it. The modeler preset compacts context at 60% pressure through the native scoped service. The guard uses public DSH APIs and persists a pause notice in ordinary session history.

Shared code and brush edits accumulate directly in the live scene. Saved snapshots can select subsequent candidates. The legacy file runtime uses blend_path to select saved inputs.

Modeling guidance treats native brushes, mesh operations, curves, modifiers, Geometry Nodes and Python as available techniques. Inherited recipes are optional references; scene checkpoints and visual acceptance document the result.

## Native sculpting

Prepare a dense, visible mesh with the existing tools, then ask the agent to enter `blender_sculpt` with `action: "begin"` and `object_name` in the current scene. Repeated `stroke` calls use native Draw, Grab, Smooth or Inflate/Deflate brushes and return image content directly to the model. `blender_view` controls standard views, orbit, zoom, pan, framing and projection. `undo`/`redo` operate on strokes; `commit` saves a new `.blend`, and `discard` exits with the original preserved.

Strokes use the latest `view_id` and 2–256 `[u,v,pressure?]` samples normalized to the returned image (top-left origin). `radius` is a fraction of image width. Each conversation owns its session; file-based tools resume after exit. Recovery files, view images and a journal remain in `.dsh-blender/scenes/<scene_id>/`. Recovery is periodic, with a default 30-minute idle timeout. The latest 64 stroke boundaries are available for undo/redo.

The first version supports fixed-topology base meshes and Essentials brushes; prepare mesh density before entry. It requires a desktop graphics context and was tested on Blender **5.2.2 LTS / macOS ARM64**. Multires, Shape Keys and Dynamic Topology are reserved for future work. The default viewport provides geometry feedback; authored camera renders remain the final appearance check.

Run `BLENDER_EXECUTABLE=/absolute/path/to/blender pnpm test:sculpt` for the real native integration test.

## Development

```sh
pnpm validate
pnpm test
```

The native reviewer lifecycle check uses a local scripted adapter and real dsh agents, with zero model API calls:

```sh
pnpm test:review-agent /absolute/path/to/dsh-host /absolute/path/to/python-with-Pillow
pnpm test:continuation /absolute/path/to/dsh-host
```

Optional integration checks exercise installed local dependencies:

```sh
pnpm setup:analysis
RUN_BLENDER_TESTS=1 pnpm test
RUN_HELPER_TESTS=1 pnpm test
```

File-based operations use local background Blender processes. Sculpting uses a persistent windowed process with a graphics context. Python modeling code has the permissions of the local Blender process; workspace output guards and validation behavior are inherited from the upstream implementation.

## Credits and license

- [CheshireJCat/blender](https://github.com/CheshireJCat/blender): the plugin foundation, Blender execution bridge, tools, skills, helpers, and validation framework.
- [CheshireJCat/blender-modeling-skill](https://github.com/CheshireJCat/blender-modeling-skill) and [RobLe3/cc-blender-skill](https://github.com/RobLe3/cc-blender-skill): the source and lineage of bundled modeling skills and modules.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): the host agent runtime and plugin system.
- [Blender](https://www.blender.org/): the 3D creation application used by the plugin.

The plugin code retains the upstream [MIT license](LICENSE). Additional provenance and preserved license files are listed in [NOTICE](NOTICE) and under `skills/create-3d-model/`. Blender is a separate project with its own license. DSH 3D is an independent community project.

## Examples

Two autonomous dev.19 tasks cover [ceramic product modeling and a desk-fan animation](examples/dev19/README.md), with editable assets, renders, prompts and tool-use summaries.
