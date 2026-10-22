# DSH 3D

[English](README.md)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Blender 建模与参考图像三维重建插件。

项目基于 [CheshireJCat/blender](https://github.com/CheshireJCat/blender) 的 `dsh-blender` 0.2.3 开发，起点提交为 `9bd95e97a61096cfae1edb0f88fcd2be54b0adee`；保留上游 Git 历史、许可、工具、skills 和分析脚本。

## 当前进展

开发版已加入持续雕刻会话和实时视口图片反馈。Agent 可以在同一场景中连续使用笔刷、调整视角、撤销和重做，在退出编辑时保存新的 `.blend`。

当前能力包括：

- 16 个工具：上游的 13 个 Blender 工具，加上 `blender_sculpt`、`blender_view` 和独立的 `review_reconstruction`。
- 默认提供 1 个精简建模 skill，附带原生画笔说明和可选分析工具。29 个上游领域 skill 保留为兼容资料，可通过 `registerModuleSkills: true` 显式启用。
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

## 独立视觉评审

`review_reconstruction` 把参考图和 1～6 张真实模型渲染交给独立上下文的视觉模型，返回 `same`、`approved`、置信度和具体差异，并保存包含模型路由、固定评审标准、原始回复、图片哈希及 `.blend` 哈希的报告。开始图像重建时用 `action: "begin"` 登记参考图；插件通过 dsh 公开的回合结束钩子持续推进同一会话，直到当前工程与渲染获得评审通过。`action: "status"` 返回当前编辑检查点与审核状态；正式评审需要提供 `blend_path`。

默认使用已配置的 `deepseek-official / deepseek-flash`，通过独立上下文评审。配置 `reviewProvider` 和 `reviewModel` 可选择其他已接入且支持图像的模型。评审会向所选服务发送证据图片，按该服务正常 API 规则计费。`reviewTimeoutMs` 默认 180000，`reviewMaxOutputTokens` 默认 8192。建模 agent 的工具参数负责提供证据，评审路由和评判标准由插件配置维护。

工具输入示例：

```json
{"reference_path":"inputs/reference.jpg","render_paths":["artifacts/front.png","artifacts/side.png","artifacts/back.png"],"render_views":["reference-aligned","side","back"],"blend_path":"artifacts/model-v003.blend","report_path":"artifacts/review-v003.json"}
```

`continueUntilApproved` 默认开启。`reviewContinuationBudgetMs` 默认为 0，沿用宿主与用户的资源限制；正数可配置显式的持续运行时间预算。评审服务错误会暂停任务，用户停止会终止当前回合。恢复会话后保留普通会话记录中的编辑检查点，收到用户继续指令后通过 `action: "begin"` 恢复推进。公开钩子会在提前收尾的文字之后追加后续工作，聊天记录会保留这些中间消息。

画笔提交后的场景会成为当前编辑检查点；后续插件 Python 修改使用这个文件作为 `blend_path`，使雕刻与代码修改可以累积。各区域的形态依据参考图中观察到的非对称关系分别塑造。

建模说明允许自由组合原生笔刷、网格编辑、曲线、修改器、Geometry Nodes 和 Python；上游配方作为可选参考，通过工程快照和视觉验收记录结果。

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
