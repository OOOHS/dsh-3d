# DSH 3D

[English](README.md)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Blender 建模与参考图像三维重建插件。

项目基于 [CheshireJCat/blender](https://github.com/CheshireJCat/blender) 的 `dsh-blender` 0.2.3 开发，起点提交为 `9bd95e97a61096cfae1edb0f88fcd2be54b0adee`；保留上游 Git 历史、许可、工具、skills 和分析脚本。

## 设计原则

DSH 3D 希望给 agent 足够宽的建模操作空间、有效反馈，以及改进自身方法的余地。目前的开发围绕三条原则展开：

### 1. 持续改进：GRM in the loop 与可复用代码

让生成式评审持续参与改进。当前通过独立的视觉评审 agent，对照参考图与真实渲染，给出差异点评和验收判断。建模 agent 根据反馈调整几何、表示方法或操作方式。每次评审独立接收本轮冻结证据，最终验收对应所选场景及其渲染；持续运行遵循用户停止、资源预算与停滞处理。

让有效工作沉淀为可复用代码。Agent 可以在运行中创建、调用和修改项目工具，保留有用实现及其观察结果、适用条件。代码与画笔共享实时场景，后续操作可以继续发展已有几何。持续改进同时作用于资产质量和工作方法：通过评审改进结果，通过代码复用积累操作能力。

### 2. Tool scaling：扩展操作能力与组合空间

扩展工具的能力覆盖、可组合性和可发现性。代码编辑、原生画笔、场景检查、视角控制、图像裁切与检查点，让 agent 能够构建、改形、观察和回溯。代码与画笔的建模范围存在重叠，可以在任务各阶段交替使用。

保持默认入口精简，详细能力按需发现，并让 agent 把已有操作组合成自己的工具。运行中可修改的项目代码，让操作空间随着任务发展而扩展。通过实际几何变化和视觉结果评估这些能力。

### 3. Skill prune：精简指令，探索放权

主 skill 聚焦目标、能力范围、执行契约与验收依据；详细协议和专业资料按需读取。表示方法、组件边界、建模手段、工作顺序、试验和候选比较由 agent 自主选择。

评审反馈与实际观察为选择提供依据。Agent 可以随任务经验修改工具和方法，通过检查点保留可比较、可恢复的候选。插件提供持续状态、反馈与探索空间，agent 在其中发展自己的工作方式。

## 当前进展

开发版提供同一实时 Blender 工作场景。Agent 可以交替使用增量 Python、原生笔刷和视角观察，保存候选，并在运行中编写、修改、复用自己的项目工具。方法与工作顺序由 agent 根据实际结果选择。

当前能力包括：

- 默认 7 个工具：`blender_scene`、`blender_execute`、`blender_sculpt`、`blender_view`、`blender_checkpoint`、`inspect_image` 和 `review_reconstruction`。
- 两份独立的原生 agent 配置：DSH 3D 建模与 DSH 3D 评审。评审角色提供图像观察和结构化提交两个工具。
- 默认提供 1 个精简建模 skill，附带原生画笔说明和可选分析工具。29 个上游领域 skill 保留为兼容资料，可通过 `registerModuleSkills: true` 显式启用。
- 26 个上游分析与验证 helper 作为兼容资料保留；`exposeLegacyTools:true` 开放文件工具与 helper，目录默认返回简短索引。`enableSharedScene:false` 选择旧版文件执行方式。

## 共享工作场景与项目工具

`blender_execute` 直接修改当前场景；第一次调用会创建空场景。`blender_scene` 的 `new`、`open` 明确选择起点，`inspect` 查询组件事实，`save` 保存项目快照并保持场景打开。代码和笔刷操作使用同一个 Blender 进程与网格；代码异常时恢复到操作前的场景。每次操作保存的工作文件、视图和日志位于 `.dsh-blender/scenes/<scene_id>/`。

Agent 可以用普通文件工具编写 `tools/*.py`，定义 `run(params)`，随后通过 `blender_execute({tool_path:"tools/example.py",params:{...}})` 调用。每次读取当前源文件，修改下一次调用即生效。执行环境提供 `bpy`、`bmesh`、`mathutils`、`workspace`、`params` 和 `dsh`；`dsh` 可调用观察、选取、笔刷、渲染与检查操作。工具输出记录源代码哈希和实际对象变化。[完整执行契约与例子](skills/create-3d-model/references/shared-scene.md)。

`blender_sculpt` 的 `begin` 选择当前场景中的组件；重复笔画、撤销和观察都保留在同一场景。`commit` 退出画笔模式并保留修改，可选另存快照；后续 `blender_execute` 继续编辑这些几何。`blender_view` 的 `kind:"render"` 使用场景相机渲染，并记录场景版本、图像哈希和来源。

本地已在 macOS ARM64、dsh `0.2.1-alpha.2`、Blender `5.2.2 LTS` 下验证插件加载、立方体创建、渲染、GLB 导出与干净回读，以及图像分析 helper。[上游兼容性报告](docs/compatibility-v0.2.3.md) 另行保留原项目的历史验证记录。

## 方法与候选探索

模型可以在迭代中调整建模方法、工作顺序与组件边界。主 skill 描述目标、可用能力和验收依据；候选数量、探索时机和评审时机由模型选择。

`blender_checkpoint` 独立提供 `save`、`list`、`get`、`restore`：归档工程、可打包资源、可选对照图片与方法备注，用 `parent_id` 记录来源；任意候选都可以恢复到工作文件继续编辑。雕刻提交后的场景同样可以作为分支起点，较早候选也保持可用。最终验收核对所选工程和渲染的当前哈希。

画笔视图默认用橙色标出目标、灰色显示上下文，返回目标的屏幕范围与射线确认的表面点；`isolate` 可独立观察组件，`probe_points` 可查询图像坐标命中的对象、位置与法线。显示颜色为临时观察效果，原场景材质保持原值。原生几何笔刷扩展为 14 种，覆盖体积、轮廓、尖锐褶线、收拢和表面塑形。固定拓扑基础网格仍是当前桥接接口的数据要求。

共享场景的观察与操作返回真实视图；显式开启的旧版文件工具可用于处理独立文件或后台批处理。

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

`review_reconstruction` 为每次评审创建一个全新的 dsh agent，仅接收本轮冻结的参考图、1～6 张真实模型渲染和视角标签。它可以多次使用 `inspect_image` 放大裁切，通过 `submit_review` 提交判断。字段校验错误作为工具反馈返回，评审 agent 可以在同一轮修正；confidence 是可选信息。评审完成后保存报告、证据快照、裁切观察和 agent 事件日志，再释放运行中的评审会话。

`agents/modeler.json` 和 `agents/reviewer.json` 分别维护两种角色的模型、推理档位、输出预算和指令。插件在网页注册 **DSH 3D 建模**（`dsh-3d-modeler`）与 **DSH 3D 评审**（`dsh-3d-reviewer`）原生配置；新建建模会话时选择前者。也可在插件配置的 `modelerAgent`、`reviewerAgent` 中覆盖字段。建模默认 high，评审默认 low，均使用 `deepseek-official / deepseek-flash` 和已配置的凭据。网页显式选择的建模模型继续生效；评审独立使用其角色配置。模型服务按正常 API 规则计费。

评审默认每轮最多 5 分钟、24 个观察/提交步骤，并为临时服务故障提供 2 次恢复机会。这些资源预算作用于单次评审；建模的持续迭代沿用宿主与用户限制。评审的唯一通过依据是对当前证据的有效判断；显著差异会保持验收待完成。冻结证据和当前 `.blend` 的哈希用于核对提交前后的一致性。

`inspect_image` 接收工作区路径，可选归一化 `region: [left, top, right, bottom]` 和 `zoom: 1..4`；返回真实图片、原始尺寸、像素区域与哈希，最长边限制为 2048。评审角色使用 `reference`、`render_1` 等本轮证据 ID，访问范围限定为本轮图片。裁切使用已有 Python/Pillow 分析环境。

开始图像重建时用 `action: "begin"` 登记参考图；插件通过 dsh 公开的回合结束钩子持续推进同一会话，直到当前工程与渲染获得评审通过。`action: "status"` 返回当前编辑检查点与审核状态；正式评审需要提供 `blend_path`。

工具输入示例：

```json
{"reference_path":"inputs/reference.jpg","render_paths":["artifacts/front.png","artifacts/side.png","artifacts/back.png"],"render_views":["reference-aligned","side","back"],"blend_path":"artifacts/model-v003.blend","report_path":"artifacts/review-v003.json"}
```

`continueUntilApproved` 默认开启。`reviewContinuationBudgetMs` 默认为 0，沿用宿主与用户的资源限制；正数可配置显式的持续运行时间预算。评审耗尽本轮恢复预算后返回 `unavailable`，保留 `awaiting-review` 状态并允许重新评审；用户停止会终止当前回合。恢复会话后保留普通会话记录中的编辑检查点，收到用户继续指令后通过 `action: "begin"` 恢复推进。公开钩子会在提前收尾的文字之后追加后续工作，聊天记录会保留这些中间消息。

自动收尾时，插件会核对新的成功工具操作和已保存场景内容。连续三个结束边界处于停滞状态时，控制器在其中安排一次有时限的上下文恢复；恢复后仍无进展则暂停，保留当前检查点与未完成的验收状态。状态查询、重复提交相同证据会保留停滞计数；实际工作会清零计数。建模配置通过原生局部服务在 60% 上下文压力时压缩历史。检测与恢复均使用 dsh 公开接口，暂停通知保存在普通会话记录中。

共享场景中的代码与笔刷修改直接累积，保存快照可以选择后续候选。旧版文件模式通过 `blend_path` 选择保存后的工程。

建模说明允许自由组合原生笔刷、网格编辑、曲线、修改器、Geometry Nodes 和 Python；上游配方作为可选参考，通过工程快照和视觉验收记录结果。

## 连续雕刻

使用已有工具准备可见且密度足够的网格，然后让 Agent 调用 `blender_sculpt`，以 `action: "begin"` 和 `object_name` 进入当前场景的笔刷模式。模型可以反复调用 `stroke` 使用原生 Draw、Grab、Smooth、Inflate/Deflate 笔刷，每次调用直接返回图片内容。`blender_view` 提供标准视角、环绕、缩放、平移、取景和投影切换；`undo` / `redo` 按笔画回退；`commit` 保留几何并退出笔刷模式；`discard` 恢复到本次画笔尝试的起点。

笔画使用最近返回的 `view_id`，以及 2～256 个 `[u,v,pressure?]` 采样点。坐标归一化到图片的 0～1 范围，原点在左上角；半径为图片宽度的比例。会话归属当前对话，代码与画笔共享几何。恢复文件、视图和日志保存在 `.dsh-blender/scenes/<scene_id>/`；恢复文件在进入时及之后定期保存，默认空闲 30 分钟后退出，撤销最多保留最近 64 个笔画边界。

首版覆盖固定拓扑的基础网格和 Essentials 笔刷，进入前准备好网格密度。需要桌面图形上下文，已在 **Blender 5.2.2 LTS / macOS ARM64** 验证。Multires、Shape Keys 和动态拓扑留待后续扩展。视口用于观察几何，提交后使用正式相机渲染检查最终材质与灯光。

真实原生接口测试：`BLENDER_EXECUTABLE=/absolute/path/to/blender pnpm test:sculpt`。

## 开发检查

```sh
pnpm validate
pnpm test
```

评审生命周期检查使用真实 dsh agent 与本地脚本模型适配器，模型 API 调用为 0：

```sh
pnpm test:review-agent /absolute/path/to/dsh-host /absolute/path/to/python-with-Pillow
pnpm test:continuation /absolute/path/to/dsh-host
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
