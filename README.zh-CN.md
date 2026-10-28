# dsh-3d · DSH 3D

[English](README.md)

**面向自主 3D 创作的 agent 工作台。** DSH 3D 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Blender 插件，让 agent 在持续的工作场景中创建资产、观察结果、修改作品，并积累可复用的操作方法。任务可以覆盖产品建模、场景搭建、材质与灯光、动画、已有资产修改和图像重建。

项目基于 [CheshireJCat/blender](https://github.com/CheshireJCat/blender) 的 `dsh-blender` 开发，在其工具、skills 和分析能力上扩展了共享编辑场景、原生画笔与视觉反馈、独立评审，以及运行中可修改、可重放的项目工具。

## 使用 DSH 3D 制作

两个独立的 dsh 会话使用 dsh-3d dev.20 完成了以下产品的设计、建模与渲染。Agent 自行选择构建方法，观察渲染并调整作品。

### MERIDIAN 陶瓷杯

象牙白竖纹杯身、深绿釉面与陶土色底圈。

![MERIDIAN 陶瓷杯](examples/dev20-showcase/cup.png)

### AURA 桌面风扇

奶油白机壳、深绿色扇叶与支架，配黄铜色细节。

![AURA 桌面风扇](examples/dev20-showcase/fan.png)

[原始任务与生成说明](examples/dev20-showcase/README.md)

## 设计原则

### 1. 持续改进：GRM in the loop 与可复用代码

持续改进同时面向作品和工作方法。

图像重建通过独立的生成式视觉评审 agent 对照参考图与渲染，指出差异并判断是否通过。建模 agent 可以根据反馈修改作品，再提交新的结果。每次评审从本轮证据开始，保存判断与观察记录。

Agent 也可以在任务中编写、调用和修改自己的工具，把有用的操作保存为代码。后续工作可以复用这些实现，调整参数或重新组织操作。代码化的操作涵盖几何构造、网格编辑、画笔、观察与交付，使模型能维护一份包含多种方法的可重放程序。

### 2. Tool scaling：扩大可用能力与组合空间

为 agent 准备构建、编辑、观察和恢复所需的工具，并让这些能力能够组合使用。Python、网格编辑和原生画笔共享同一个 Blender 场景；模型可以操作已有几何，也可以生成新的组件。

工具反馈提供视图、局部前后对照和实际变化，帮助模型判断操作效果。能力通过简洁入口和按需查询开放，agent 可以进一步把多个操作组合成适合当前任务的工具。

### 3. Skill pruning：通过精简指令实现探索放权

主 skill 讲清任务目标、能力范围、调用方式和完成依据，专业资料按需读取。精简预设工作流与重复指令，把表示方法、组件划分、操作顺序和候选比较交给 agent 决定。

观察、评审和检查点为探索提供依据：模型可以尝试一种做法，检查效果，保留成果，或恢复较早的场景继续尝试。

## 工作台提供什么

- **持续编辑的场景**：代码、网格操作和画笔作用于同一份资产，选择、编辑模式和工具设置跨调用保留。场景快照和检查点支持保存、恢复与比较候选。
- **广泛的 Blender 操作**：通过 Python 使用几何、曲线、修改器、Geometry Nodes、材质、灯光、绑定与动画能力；通过原生工具进行选区编辑、比例变形、挤出和雕刻。
- **可见的操作反馈**：视角控制、组件隔离、相机渲染、图像裁切，以及画笔和局部编辑的前后对照，支持持续观察与修正。
- **可积累的项目工具**：运行中编写和修改工具，下次调用加载最新代码。会话经验库保存操作结果和适用条件；新会话从基础经验开始。
- **评审与交付**：图像重建可接入独立视觉评审；资产支持导入导出、结构检查、导出回读验证和动画抽帧。

[陶瓷杯与风扇动画案例](examples/dev19/README.md)提供可编辑资产、渲染、原始任务提示和工具调用摘要。

## 开始使用

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

### 选择建模配置

新建会话时，可以选择：

- **DSH 3D 建模**（`dsh-3d-modeler`）：直接调用 Python、原生编辑、画笔和观察工具。
- **DSH 3D 代码建模**（`dsh-3d-code-modeler`）：在 `run_code` 中通过 `await tools.工具名(...)` 组合已授权工具，适合维护可重放程序。该配置需要宿主提供程序化工具运行能力。
- **DSH 3D 原生建模实验**（`dsh-3d-native-modeler`）：使用基本体、原生网格编辑和画笔等工具，供动作空间对照实验使用。

例如，可以直接提出任务：“创建一个带小鲸鱼浮雕的陶瓷杯，保存可编辑工程、GLB 和多视角渲染。” 模型根据任务选择方法、观察结果和调整作品。

建模与评审分别配置在 `agents/modeler.json` 和 `agents/reviewer.json`，也可通过插件的 `modelerAgent`、`reviewerAgent` 配置覆盖。默认使用 `deepseek-official / deepseek-flash`，建模推理档位为 high，评审为 low；建模会话中的显式模型选择继续生效。

## 持续编辑与代码重放

`blender_execute` 在当前场景中执行 Python，`blender_scene` 负责新建、打开、检查和保存场景。项目代码可以定义 `run(params)`，通过 `tool_path` 反复调用；每次调用都会读取最新源文件。

原生画笔修改后的网格可以继续由 Python 编辑。代码建模配置还允许把画笔步骤写入完整程序，随构造步骤一起重放。Blender Python 中的 `dsh.edit`、`dsh.sculpt`、`dsh.project` 和 `dsh.emit` 提供编辑、雕刻、位置投影和图像返回。

重放程序需要保留起始场景、参数、依赖和操作顺序。屏幕笔触随视角和几何变化，定位代码可以在执行时重新投影目标位置。跨多个工具调用执行时，后续调用失败会保留之前已完成的操作，供模型检查并恢复。

- [共享场景与项目工具](skills/create-3d-model/references/shared-scene.md)
- [代码重放说明](skills/create-3d-model/references/code-replay.md)与[完整示例](examples/code-replay/README.md)
- [网格编辑与视觉反馈](docs/editing-feedback.md)

### 原生画笔

画笔支持体积塑形、轮廓调整、弯曲、褶皱和表面处理。进入画笔模式后，可以连续下笔、切换视角、撤销或重做；退出时保留修改，放弃时恢复进入该模式前的状态。画笔资产和参数从本机 Blender 按需查询。

当前桥接接口作用于固定拓扑基础网格，局部需要足够的实际顶点。雕刻运行需要桌面图形上下文；Multires、Shape Keys 和动态拓扑尚未接入。接口已在 Blender 5.2.2 LTS、macOS ARM64 上验证。详见[雕刻接口说明](skills/create-3d-model/references/sculpting.md)。

## 图像重建评审

通过 `review_reconstruction` 的 `begin` 登记参考图后，建模 agent 可以提交保存的场景与 1～6 张对应渲染。每次评审创建独立 agent，使用本轮图片进行观察和裁切，返回差异点评与验收判断，并保存证据和报告。格式错误会反馈给评审 agent，在本轮继续修正。

评审通过对应当前提交的场景和渲染。默认持续推进已登记的重建任务，直到通过、用户停止、运行预算耗尽或进展停滞时暂停。`continueUntilApproved` 控制持续推进，`reviewContinuationBudgetMs` 设置运行时间预算；默认值 0 沿用宿主与用户限制。评审本身每轮默认最多 5 分钟、24 个步骤和 2 次临时服务故障恢复。

评审模型独立配置，调用使用相应模型服务并产生 API 费用。自由创作任务按用户要求交付；当前参考图评审用于图像重建。

## 开发与验证

本地开发环境使用 dsh `0.2.1-alpha.2`、Blender `5.2.2 LTS` 和 macOS ARM64。基础检查：

```sh
pnpm validate
pnpm test
```

本机集成测试需要安装 Blender 和分析依赖：

```sh
pnpm setup:analysis
BLENDER_EXECUTABLE=/absolute/path/to/blender pnpm test:sculpt
pnpm test:acceptance
```

评审生命周期和持续运行检查使用真实 dsh agent 与本地脚本模型适配器：

```sh
pnpm test:review-agent /absolute/path/to/dsh-host /absolute/path/to/python-with-Pillow
pnpm test:continuation /absolute/path/to/dsh-host
```

Python 建模代码以本机 Blender 进程权限运行。工作文件、恢复场景和观察记录保存在项目的 `.dsh-blender/scenes/` 中。

## 致谢与许可

- [CheshireJCat/blender](https://github.com/CheshireJCat/blender)：插件基础、Blender 执行桥接、工具、skills、分析脚本与验证能力。
- [CheshireJCat/blender-modeling-skill](https://github.com/CheshireJCat/blender-modeling-skill) 与 [RobLe3/cc-blender-skill](https://github.com/RobLe3/cc-blender-skill)：随插件提供的建模 skills 及模块的来源。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：agent 运行环境与插件系统。
- [Blender](https://www.blender.org/)：插件使用的三维创作软件。

插件代码保留上游 [MIT 许可](LICENSE)，其他来源说明及保留的许可文件见 [NOTICE](NOTICE) 与 `skills/create-3d-model/`。Blender 是使用其自身许可的独立项目；DSH 3D 是社区开发项目。
