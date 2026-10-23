# DSH 3D

[简体中文](README.zh-CN.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for Blender-based 3D modeling and reconstruction from reference images.

DSH 3D is developed from [CheshireJCat/blender](https://github.com/CheshireJCat/blender) (`dsh-blender` 0.2.3, commit `9bd95e97a61096cfae1edb0f88fcd2be54b0adee`). The upstream Git history, license files, skills, tools, and analysis helpers are preserved.

## Status

The development version adds persistent native sculpting and live viewport feedback. An agent can keep one editing session open, use brushes repeatedly, change views, undo/redo, and save a new `.blend` when the edit is complete.

Current capabilities include:

- 18 tools: the 13 upstream Blender tools, `blender_sculpt`, `blender_view`, `review_reconstruction`, shared `inspect_image`, and `blender_checkpoint`.
- Independent native DSH modeler/reviewer presets. The scoped reviewer receives observation and structured submission tools.
- One concise modeling skill by default, with native brush guidance and optional reference-analysis helpers. The 29 upstream domain skills remain available through `registerModuleSkills: true` for legacy use.
- 26 analysis and validation helpers, with 23 enabled by default.

The local development setup has exercised plugin loading, cube creation, rendering, GLB export and clean re-import, and an image-analysis helper using dsh `0.2.1-alpha.2` and Blender `5.2.2 LTS` on macOS ARM64. The historical [upstream compatibility report](docs/compatibility-v0.2.3.md) records the original project's separate validation.

## Exploring methods and candidates

The model chooses and revises its methods, work order and component boundaries. The main skill describes goals, capabilities and acceptance evidence; exploration timing, candidate count and intermediate review timing remain agent decisions.

`blender_checkpoint` provides independent `save`, `list`, `get` and `restore` operations. It archives scenes, packable resources, optional comparison images and free-form notes; `parent_id` records a candidate's origin. Any saved alternative can be restored into a working file, including earlier candidates after a sculpt commit. Final acceptance validates the selected current scene and render hashes.

Brush views highlight the target in orange, show context in gray, and return projected bounds and raycast-confirmed surface samples. `isolate` displays a component alone; `probe_points` returns hit objects, world locations and normals for image coordinates. Display colors are temporary. Fourteen native geometry brushes cover contour, volume, creases, pinching and surface shaping. The current brush bridge still requires fixed-topology base meshes.

File tools can inspect or branch saved scenes while a live brush copy is open. Commit publishes live shaping as a saved candidate. Preview and render tools return direct images when the host attachment service is available.

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

Brush commits become the current editable checkpoint. Subsequent plugin Python edits use that checkpoint as `blend_path`, so brush shaping and later code changes accumulate together. The reference's observed asymmetry guides regional shaping.

Modeling guidance treats native brushes, mesh operations, curves, modifiers, Geometry Nodes and Python as available techniques. Inherited recipes are optional references; scene checkpoints and visual acceptance document the result.

## Native sculpting

Prepare a dense, visible mesh with the existing tools, then ask the agent to enter `blender_sculpt` with `action: "begin"`, the input `blend_path` and `object_name`. Repeated `stroke` calls use native Draw, Grab, Smooth or Inflate/Deflate brushes and return image content directly to the model. `blender_view` controls standard views, orbit, zoom, pan, framing and projection. `undo`/`redo` operate on strokes; `commit` saves a new `.blend`, and `discard` exits with the original preserved.

Strokes use the latest `view_id` and 2–256 `[u,v,pressure?]` samples normalized to the returned image (top-left origin). `radius` is a fraction of image width. Each conversation owns its session; file-based tools resume after exit. Recovery files, view images and a journal remain in `.dsh-blender/sculpt/<edit_id>/`. Recovery is periodic, with a default 30-minute idle timeout. The latest 64 stroke boundaries are available for undo/redo.

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
