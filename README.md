# dsh-3d · DSH 3D

[简体中文](README.zh-CN.md)

**An agent workspace for autonomous 3D creation.** DSH 3D is a Blender plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It gives agents a persistent environment to create assets, inspect results, revise their work and develop reusable tools. Tasks span product modeling, scene assembly, materials and lighting, animation, asset editing and reconstruction from images.

Built on [CheshireJCat/blender](https://github.com/CheshireJCat/blender) (`dsh-blender`), the project extends its tools, skills and analysis capabilities with shared editing state, native brushes and visual feedback, independent review, and project tools that agents can revise and replay during a task.

## Made with DSH 3D

Two independent dsh sessions designed, modeled and rendered these products with dsh-3d dev.20. Each agent chose its construction methods, inspected renders and refined the result.

### MERIDIAN ceramic cup

Ivory fluting, deep green glaze and an exposed clay-colored foot.

![MERIDIAN ceramic cup](examples/dev20-showcase/cup.png)

### AURA desk fan

A cream housing, forest-green blades and stand, and brass-colored accents.

![AURA desk fan](examples/dev20-showcase/fan.png)

[Task prompts and generation details](examples/dev20-showcase/README.md)

## Design principles

### 1. Continuous improvement: GRM in the loop and reusable code

Improvement applies to both the asset and the way it is made.

For image reconstruction, an independent generative visual reviewer compares renders with the reference, describes differences and judges acceptance. The modeling agent can revise the asset and submit another result. Each review starts with the current evidence and saves its observations and judgment.

Agents can also write, call and revise their own tools during a task, preserving useful operations as code. Later work can reuse implementations, adjust parameters or reorganize the operations. Geometry construction, mesh editing, brushes, observation and delivery can all be composed into a replayable program.

### 2. Tool scaling: expand capabilities and their combinations

Provide the tools an agent needs to construct, edit, observe and recover, and make those tools work together. Python, mesh editing and native brushes share one Blender scene. Agents can modify existing geometry or create new components.

Tool feedback includes views, local before-and-after images and measured changes, helping the model assess the effect of an action. Compact entry points and on-demand discovery expose detailed capabilities. Agents can compose these operations into tools suited to the task.

### 3. Skill pruning to enable autonomous exploration

The main skill explains goals, capabilities, calling conventions and completion criteria. Specialist references are loaded as needed. Pruning prescribed workflows and repeated instructions gives the agent control over representations, component boundaries, operation order and candidate comparisons.

Observations, reviews and checkpoints support exploration: try an approach, inspect its effect, keep the result or restore an earlier scene and try again.

## What the workspace provides

- **Persistent editing:** code, mesh operations and brushes act on the same assets. Selection, editing mode and tool settings persist across calls. Snapshots and checkpoints support saving, restoring and comparing candidates.
- **Broad Blender access:** Python exposes geometry, curves, modifiers, Geometry Nodes, materials, lighting, rigging and animation. Native controls provide mesh selection, proportional editing, extrusion and sculpting.
- **Visual action feedback:** view control, component isolation, camera renders, image crops and local before-and-after comparisons support observation and correction.
- **Reusable project tools:** agents write and revise tools during execution; the next call loads the current source. Session notes retain observed outcomes and conditions of use. New sessions start with foundation guidance.
- **Review and delivery:** image reconstruction can use independent visual review. Asset tools cover import/export, structural checks, export round-trip validation and animation frame sampling.

The [ceramic mug and animated fan examples](examples/dev19/README.md) include editable assets, renders, original prompts and tool-use summaries.

## Getting started

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

### Choose a modeling preset

When creating a session, choose:

- **DSH 3D 建模** (`dsh-3d-modeler`): direct access to Python, native editing, brushes and observation tools.
- **DSH 3D 代码建模** (`dsh-3d-code-modeler`): compose authorized tools as `await tools.name(...)` inside `run_code`, suitable for maintaining replayable programs. This preset requires the host's programmatic tool runtime.
- **DSH 3D 原生建模实验** (`dsh-3d-native-modeler`): primitives, native mesh editing and brushes for action-space comparison experiments.

For example: “Create a ceramic mug with a small whale relief. Save the editable project, a GLB and renders from several viewpoints.” The agent chooses methods, observes results and revises the asset.

Modeling and review are configured separately in `agents/modeler.json` and `agents/reviewer.json`, with overrides through `modelerAgent` and `reviewerAgent`. Defaults use `deepseek-official / deepseek-flash`, with high reasoning effort for modeling and low for review. Explicit model selections in the modeling session remain effective.

## Continuous editing and code replay

`blender_execute` runs Python in the current scene. `blender_scene` creates, opens, inspects and saves scenes. Project tools can define `run(params)` and be called repeatedly through `tool_path`; each call loads the latest source.

Python can continue editing meshes shaped with native brushes. The code-modeling preset also lets agents record brush steps in a complete program and replay them alongside construction. Within Blender Python, `dsh.edit`, `dsh.sculpt`, `dsh.project` and `dsh.emit` provide editing, sculpting, location projection and image output.

Replay programs retain the starting scene, parameters, dependencies and operation order. Screen-space strokes depend on the view and geometry; targeting code can project locations again during execution. Across multiple tool calls, a later failure preserves earlier completed operations for inspection and recovery.

- [Shared scenes and project tools](skills/create-3d-model/references/shared-scene.md)
- [Code replay contract](skills/create-3d-model/references/code-replay.md) and [complete example](examples/code-replay/README.md)
- [Mesh editing and visual feedback](docs/editing-feedback.md)

### Native brushes

Brushes support volume shaping, silhouette changes, bending, folds and surface work. In sculpt mode, agents can make successive strokes, change views, undo and redo. Committing retains the edits; discarding restores the state from entry. Brush assets and parameters are discovered from the local Blender installation.

The current bridge operates on fixed-topology base meshes with sufficient actual vertices in the edited region. Sculpting requires a desktop graphics context. Multires, Shape Keys and Dynamic Topology are currently unsupported. The interface has been tested on Blender 5.2.2 LTS and macOS ARM64. See the [sculpting contract](skills/create-3d-model/references/sculpting.md).

## Review for image reconstruction

After registering a reference through `review_reconstruction` with `action: "begin"`, the modeling agent can submit a saved scene and 1–6 corresponding renders. Each assessment creates an independent reviewer that observes and crops the current images, returns differences and an acceptance judgment, and archives the evidence and report. Format errors are returned as feedback so the reviewer can repair its submission within the round.

Acceptance applies to the submitted scene and renders. Registered reconstruction tasks continue by default until approval, user cancellation, a runtime budget limit or a pause for stalled progress. `continueUntilApproved` controls continuation; `reviewContinuationBudgetMs` sets a time budget, with the default of 0 following host and user limits. Each review defaults to five minutes, 24 steps and two recoveries from transient service errors.

Review uses its own model configuration and incurs the provider's API charges. Free-form creation follows the user's deliverables; the reference-image reviewer serves reconstruction tasks.

## Development and validation

The local development environment uses dsh `0.2.1-alpha.2`, Blender `5.2.2 LTS` and macOS ARM64. Basic checks:

```sh
pnpm validate
pnpm test
```

Local integration tests require Blender and the analysis dependencies:

```sh
pnpm setup:analysis
BLENDER_EXECUTABLE=/absolute/path/to/blender pnpm test:sculpt
pnpm test:acceptance
```

Reviewer lifecycle and continuation checks use real dsh agents with a local scripted model adapter:

```sh
pnpm test:review-agent /absolute/path/to/dsh-host /absolute/path/to/python-with-Pillow
pnpm test:continuation /absolute/path/to/dsh-host
```

Python modeling code runs with the local Blender process's permissions. Working files, recovery scenes and observations are stored in the project's `.dsh-blender/scenes/` directory.

## Credits and license

- [CheshireJCat/blender](https://github.com/CheshireJCat/blender): the plugin foundation, Blender execution bridge, tools, skills, helpers, and validation framework.
- [CheshireJCat/blender-modeling-skill](https://github.com/CheshireJCat/blender-modeling-skill) and [RobLe3/cc-blender-skill](https://github.com/RobLe3/cc-blender-skill): the source and lineage of bundled modeling skills and modules.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): the host agent runtime and plugin system.
- [Blender](https://www.blender.org/): the 3D creation application used by the plugin.

The plugin code retains the upstream [MIT license](LICENSE). Additional provenance and preserved license files are listed in [NOTICE](NOTICE) and under `skills/create-3d-model/`. Blender is a separate project with its own license. DSH 3D is an independent community project.
