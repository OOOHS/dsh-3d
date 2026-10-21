# DSH 3D

[简体中文](README.zh-CN.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for Blender-based 3D modeling and reconstruction from reference images.

DSH 3D is developed from [CheshireJCat/blender](https://github.com/CheshireJCat/blender) (`dsh-blender` 0.2.3, commit `9bd95e97a61096cfae1edb0f88fcd2be54b0adee`). The upstream Git history, license files, skills, tools, and analysis helpers are preserved.

## Status

This is an early development baseline. Current project-specific changes establish a separate plugin identity, local installation, bilingual display metadata, and project documentation. Research and implementation of additional reconstruction capabilities will build on this baseline.

The inherited capabilities include:

- 13 Blender tools for scene inspection, Python modeling, imports, previews, rendering, exports, and validation.
- 30 skills covering modeling, reference-image reconstruction, materials, lighting, animation, and artifact handoff.
- 26 analysis and validation helpers, with 23 enabled by default.

The local development setup has exercised plugin loading, cube creation, rendering, GLB export and clean re-import, and an image-analysis helper using dsh `0.2.1-alpha.2` and Blender `5.2.2 LTS` on macOS ARM64. The historical [upstream compatibility report](docs/compatibility-v0.2.3.md) records the original project's separate validation.

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

## Development

```sh
pnpm validate
pnpm test
```

Optional integration checks exercise installed local dependencies:

```sh
pnpm setup:analysis
RUN_BLENDER_TESTS=1 pnpm test
RUN_HELPER_TESTS=1 pnpm test
```

Blender operations run through local background Blender processes. Python modeling code has the permissions of the local Blender process; workspace output guards and validation behavior are inherited from the upstream implementation.

## Credits and license

- [CheshireJCat/blender](https://github.com/CheshireJCat/blender): the plugin foundation, Blender execution bridge, tools, skills, helpers, and validation framework.
- [CheshireJCat/blender-modeling-skill](https://github.com/CheshireJCat/blender-modeling-skill) and [RobLe3/cc-blender-skill](https://github.com/RobLe3/cc-blender-skill): the source and lineage of bundled modeling skills and modules.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): the host agent runtime and plugin system.
- [Blender](https://www.blender.org/): the 3D creation application used by the plugin.

The plugin code retains the upstream [MIT license](LICENSE). Additional provenance and preserved license files are listed in [NOTICE](NOTICE) and under `skills/create-3d-model/`. Blender is a separate project with its own license. DSH 3D is an independent community project.
