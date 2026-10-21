# DSH 3D

[English](README.md)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Blender 建模与参考图像三维重建插件。

项目基于 [CheshireJCat/blender](https://github.com/CheshireJCat/blender) 的 `dsh-blender` 0.2.3 开发，起点提交为 `9bd95e97a61096cfae1edb0f88fcd2be54b0adee`；保留上游 Git 历史、许可、工具、skills 和分析脚本。

## 当前进展

开发版已加入持续雕刻会话和实时视口图片反馈。Agent 可以在同一场景中连续使用笔刷、调整视角、撤销和重做，在退出编辑时保存新的 `.blend`。

当前能力包括：

- 15 个 Blender 工具：上游的 13 个工具，加上 `blender_sculpt` 和 `blender_view`。
- 30 个 skills，覆盖建模、参考图重建、材质、灯光、动画和产物交付。
- 26 个分析与验证 helper，默认启用其中 23 个。

本地已在 macOS ARM64、dsh `0.2.1-alpha.2`、Blender `5.2.2 LTS` 下验证插件加载、立方体创建、渲染、GLB 导出与干净回读，以及图像分析 helper。[上游兼容性报告](docs/compatibility-v0.2.3.md) 另行保留原项目的历史验证记录。

## 从源码安装

环境要求：Node.js 22.12+、pnpm、可执行的 Blender，以及用于图像分析的 Python 3.10+。

```sh
git clone https://github.com/OOOHS/dsh-3d.git
cd dsh-3d
pnpm install --frozen-lockfile
npx @deepseek-ai/dsh@0.2.1-alpha.2 plugin --profile web add .
npx @deepseek-ai/dsh@0.2.1-alpha.2 plugin --profile web exec dsh-3d-setup
npx @deepseek-ai/dsh@0.2.1-alpha.2 web
```

插件页显示为 **DSH 3D（开发版）**。与原版 `dsh-blender` 切换使用时，先关闭当前版本，再开启另一个版本，每次启用其中一个。

Blender 可在 PATH 中提供，也可在 web profile 的 `cordis.patch.yml` 中配置绝对路径：

```yaml
- id: dsh-3d
  config:
    blenderExecutable: /absolute/path/to/blender
```

模型服务与 API Key 通过 dsh 环境或配置提供，密钥与本机 `.env` 文件应保存在版本控制之外。

## 连续雕刻

使用已有工具准备可见且密度足够的网格，然后让 Agent 调用 `blender_sculpt`，以 `action: "begin"`、`blend_path` 和 `object_name` 进入编辑。模型可以反复调用 `stroke` 使用原生 Draw、Grab、Smooth、Inflate/Deflate 笔刷，每次调用直接返回图片内容。`blender_view` 提供标准视角、环绕、缩放、平移、取景和投影切换；`undo` / `redo` 按笔画回退；`commit` 保存新的 `.blend`；`discard` 退出并保留原文件。

笔画使用最近返回的 `view_id`，以及 2～256 个 `[u,v,pressure?]` 采样点。坐标归一化到图片的 0～1 范围，原点在左上角；半径为图片宽度的比例。会话归属当前对话，退出后恢复普通文件工具。恢复文件、视图和日志保存在 `.dsh-blender/sculpt/<edit_id>/`；恢复文件在进入时及之后定期保存，默认空闲 30 分钟后退出，撤销最多保留最近 64 个笔画边界。

首版覆盖固定拓扑的基础网格和 Essentials 笔刷，进入前准备好网格密度。需要桌面图形上下文，已在 **Blender 5.2.2 LTS / macOS ARM64** 验证。Multires、Shape Keys 和动态拓扑留待后续扩展。视口用于观察几何，提交后使用正式相机渲染检查最终材质与灯光。

真实原生接口测试：`BLENDER_EXECUTABLE=/absolute/path/to/blender pnpm test:sculpt`。

## 开发检查

```sh
pnpm validate
pnpm test
```

可选的本机集成检查：

```sh
pnpm setup:analysis
RUN_BLENDER_TESTS=1 pnpm test
RUN_HELPER_TESTS=1 pnpm test
```

文件操作使用本机 Blender 后台进程；雕刻使用带图形上下文的持续窗口进程。Python 建模代码使用本地 Blender 进程的权限，工作区输出限制与验证行为沿用上游实现。

## 致谢与许可

- [CheshireJCat/blender](https://github.com/CheshireJCat/blender)：插件基础、Blender 执行桥接、工具、skills、分析脚本与验证能力。
- [CheshireJCat/blender-modeling-skill](https://github.com/CheshireJCat/blender-modeling-skill) 与 [RobLe3/cc-blender-skill](https://github.com/RobLe3/cc-blender-skill)：随插件提供的建模 skills 及模块的来源。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：agent 运行环境与插件系统。
- [Blender](https://www.blender.org/)：插件使用的三维创作软件。

插件代码保留上游 [MIT 许可](LICENSE)，其他来源说明及保留的许可文件见 [NOTICE](NOTICE) 与 `skills/create-3d-model/`。Blender 是使用其自身许可的独立项目；DSH 3D 是社区开发项目。
