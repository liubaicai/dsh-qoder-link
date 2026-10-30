<p align="center"><img src="assets/qoder.png" width="88" alt="Qoder logo"></p>
<h1 align="center">Qoder Link for DSH</h1>
<p align="center">通过官方 Qoder CLI 连接 DSH 对话、模型选择和工具调用。</p>

支持 **qodercli 国际版** 和 **qoderclicn 中国版**，通过原生 **ACP stdio** 接入。两版均直接使用官方 CLI 已保存的登录态，插件不管理账户、不获取或注入令牌；在设置中选择使用哪个区域即可。无需逆向模型 API。

> v0.1.2 起仅使用 CLI 本地登录态。升级前请先在 DSH 所在机器完成对应 CLI 登录；旧插件账户不再参与认证。

## 功能

- 模型提供商 `qoder`，默认入口 `qoder/default`，支持配置账户可用的模型 ID。
- `qoder_ask` 独立委派工具，不发送当前 DSH 历史，不切换当前模型。
- DSH 历史、系统提示词和工具结果转为完整上下文；工具调用交回 DSH 校验和执行。
- ACP 初始化、会话创建、提示请求、流式文字和思考、工具状态、取消与进程清理；用量仅在 CLI 返回时报告。
- 进程级 FIFO 并发队列、排队超时、无进展超时与取消；持续产生进展的任务不会因超过固定十分钟被终止。最近调用仅保存运行元数据。
- 参照 CodeBuddy Link 的紧凑设置布局：区域选择、模型启用按钮、默认模型、权限与推理强度、折叠运行记录和高级配置。
- 首次打开设置自动调用所选 CLI 的 `--list-models`，也可手动刷新；不访问私有模型 API，不凭空生成模型列表。
- 自带预构建 `dist`、双语插件标题和说明、Qoder logo、Cordis 安装补丁。

## 1. 安装并登录 CLI

参考 [国际版安装](https://docs.qoder.com/cli/installation) 或 [中国版安装](https://docs.qoder.cn/cli/installation)。通过官方安装器或官方 npm 包安装：

```sh
# 国际版
npm install -g @qoder-ai/qodercli
qodercli login
qodercli --version
qodercli --list-models

# 中国版
npm install -g @qodercn-ai/qoderclicn
qoderclicn login
qoderclicn --version
qoderclicn --list-models
```

新版官方安装器也可能提供 `qoder` / `qodercn` 命令。若只安装了新别名，在对应版本的可执行文件路径中填入该命令或完整路径即可。插件不会在国际版和中国版之间自动回退。

两个 CLI 的账户、服务区域和配置独立。请在运行 DSH 的同一台机器、同一操作系统账户下完成所选 CLI 的登录。浏览器登录、令牌续期和账户切换均由官方 CLI 负责；插件不读取或复制 CLI 凭据。

子进程始终清除从宿主继承的 `QODER_PERSONAL_ACCESS_TOKEN` 和 `QODERCN_PERSONAL_ACCESS_TOKEN`（含大小写变体），不再注入 PAT，避免意外使用 shell 中的其他身份。请使用 CLI 已保存的登录态，不要把令牌填进路径或模型字段。

## 2. 安装插件

需要支持第三方模型适配器与 Web 插槽的 DSH，Node.js 22.18 或更高版本。插件不会自动安装 Qoder CLI，请先按上节安装。

### 从 GitHub 安装

推荐直接使用 Release 安装包地址，固定到已发布版本：

```sh
dsh plugin --profile web add "https://github.com/liubaicai/dsh-qoder-link/releases/download/v0.1.3/dsh-qoder-link-0.1.3.tgz"
```

也可以从 GitHub 仓库的指定标签安装：

```sh
dsh plugin --profile web add "github:liubaicai/dsh-qoder-link#v0.1.3"
```

`web` 是 DSH 配置名称；如果使用其他 profile，请替换成对应名称。安装后按提示重载插件或重启 DSH，刷新网页，在 **设置 → Qoder Link** 中选择国际版或中国版，并在终端完成对应 CLI 的登录。

### 从本地安装包安装

```sh
dsh plugin --profile web add /absolute/path/dsh-qoder-link-0.1.3.tgz
```

Windows 示例：

```powershell
dsh plugin --profile web add D:\Code\Github\dsh-qoder-link\dsh-qoder-link-0.1.3.tgz
```

也可在支持本地插件包的 DSH 插件管理界面选择 `.tgz`。按 DSH 提示重载插件或重启，刷新 Web 页面。

## 3. 配置并使用

打开 **设置 → Qoder Link**（也可从插件行的配置入口打开）：

1. 选择 `qodercli` 国际版或 `qoderclicn` 中国版。
2. 通常无需填写路径；自定义安装位置可在高级设置中填写对应 CLI 路径。留空时从 PATH 查找，路径不是带参数的整条命令。
3. 在终端完成对应 CLI 登录，页面不提供账户管理或 PAT 输入。
4. 页面自动获取模型候选，也可点击“获取模型列表”。点击模型按钮启用，选择默认模型后保存；`default` 使用 CLI 自身默认值。区域或路径变更需先保存，再获取对应目录；刷新不会覆盖未保存的模型选择。
5. 保存，在 DSH 模型选择器中选择 `qoder/default` 或启用的具体模型。模型候选不保证当前额度或所有模型的调用权限。

插件默认启用，页面不再提供独立启用开关；不使用时请在 DSH 禁用插件。高级设置仅显示 CLI 路径，超时、并发、上下文预算等仍可通过下方底层配置调整；页面保存会保留这些值。

模型发现使用临时工作目录和无 shell 子进程，设置超时及输出大小上限；失败仅显示固定诊断，不返回原始 CLI 错误。状态轮询不启动 CLI。模型配置目前仍在两个区域间共享，切换后请重新确认启用项。

调用采用全局 FIFO 并发队列，不再有账户池或账户租约。区域在入队时固定，切换设置不会把已排队调用转到另一区域；CLI 自身的登录身份由其启动时读取。

命令：

```text
/qoder status
/qoder models
/qoder runs
/qoder help
```

`status` 只显示配置，不声称登录有效。思考等级可选 `auto / low / medium / high`，非 auto 透传 `--reasoning-effort`；是否支持由所选模型和 CLI 决定，不保证服务端生效。

## 安全与行为边界

- **模型适配器始终禁用 CLI 内置工具**，使用 `--tools ""`、严格空 MCP 配置、空设置来源和 `dont_ask` 权限模式。工具请求经有限、严格解析后交回 DSH，不执行回答中的任意代码片段。
- `qoder_ask` 默认也禁用 CLI 内置工具。管理员显式配置委派工具后，CLI 内部工具在 DSH 文件沙箱之外执行；仅在可信工作区启用。桥接不提供客户端文件或终端能力，也不会自动批准 ACP 权限请求。
- 每次请求启动全新 CLI，以 `--acp` 运行，经 stdin/stdout 交换 JSON-RPC 消息，完成 `initialize`、`session/new`、`session/prompt`。不恢复旧 ACP 会话，完整历史由 DSH 管理，不静默截断。CLI 自身可能持久化会话元数据，插件不承诺 CLI 侧零留存。
- CLI 是本地外部进程，不是隔离容器。官方 CLI 版本可能仍读取工作区说明或自身配置；禁用工具/MCP 不等于操作系统级沙箱。
- 仅支持文本输入；图片会明确报错。工具可用时先缓冲并校验完整响应，再输出 DSH 工具调用；纯文本可随 CLI 事件输出。
- 上下文窗口为 DSH 侧预算提示，不向 CLI 强制覆盖，也不自动推断账户真实额度。没有伪造的积分查询、登录成功或模型发现接口。
- 子进程 stderr 可能包含敏感信息，错误只显示分类，不回传原始 stderr。诊断不保存提示词、参数、工作路径或凭据。

## 配置

配置优先级：Web 保存值 > Cordis 插件配置 > 环境变量 > 默认值。保存位置为 `$DSH_HOME/plugins/dsh-qoder-link/settings.json`，未指定 DSH_HOME 时为 `~/.dsh/plugins/dsh-qoder-link/settings.json`。

配置文件损坏或包含无效字段时，插件保留原文件，关闭模型和委派入口，在设置页显示固定诊断并阻止覆盖保存。请修复或备份移走损坏配置后重载插件；不会因显示设置页面而悄悄恢复默认执行权限。

旧版生成的 `accounts.json`、托管标记及相关文件不再读取、写入或参与认证，也不会自动删除。升级后即使旧文件损坏，仍直接使用 CLI 登录态。确认不再需要旧 PAT 后，请自行妥善清理旧凭据，并在官方平台撤销不再使用的令牌；不要将旧文件提交到仓库。

| 配置 | 环境变量 | 默认值 |
| --- | --- | --- |
| `cliVariant` | `DSH_QODER_CLI_VARIANT` | `qodercli` |
| `qodercliBin` | `DSH_QODERCLI_BIN` | 空，使用 qodercli |
| `qoderclicnBin` | `DSH_QODERCLICN_BIN` | 空，使用 qoderclicn |
| `enabled` | `DSH_QODER_ENABLED` | true |
| `defaultModel` | `DSH_QODER_DEFAULT_MODEL` | default |
| `models` | `DSH_QODER_MODELS` | 逗号分隔模型 ID |
| `hiddenModels` | `DSH_QODER_HIDDEN_MODELS` | 空 |
| `reasoningEffort` | `DSH_QODER_REASONING_EFFORT` | auto |
| `workspaceRoot` | `DSH_QODER_WORKSPACE_ROOT` | 当前 DSH 会话工作区 |
| `permissionMode` | `DSH_QODER_MODE` | dont_ask，仅影响委派 |
| `tools` | `DSH_QODER_TOOLS` | 空，仅影响委派 |
| `askTool` | `DSH_QODER_ASK_TOOL` | true |
| `timeoutMs` | `DSH_QODER_TIMEOUT_MS` | 600000，ACP 无进展超时，不是总运行时限 |
| `maxConcurrency` | `DSH_QODER_MAX_CONCURRENCY` | 2，范围 1–16 |
| `queueTimeoutMs` | `DSH_QODER_QUEUE_TIMEOUT_MS` | 600000 |
| `stallWarnMs` | `DSH_QODER_STALL_WARN_MS` | 90000，0 关闭告警 |
| `contextWindow` | `DSH_QODER_CONTEXT_WINDOW` | 128000，仅作预算提示 |
| `modelContext` | `DSH_QODER_MODEL_CONTEXT` | 模型 ID 到窗口大小的 JSON 对象 |
| `maxPromptChars` | `DSH_QODER_MAX_PROMPT_CHARS` | 1000000 |

## 开发与打包

```sh
npm ci
npm run check
npm test
npm pack
```

包包含预构建代码，安装时不需要 TypeScript 编译。CI 在 Windows 和 Linux 运行类型检查、自动测试、构建一致性检查和打包；推送 `v*` 标签时发布 GitHub Release 安装包。

自动测试使用假 CLI 验证 ACP 握手、流式更新、权限拒绝、取消、无进展超时、进程清理、模型发现和 Web/UI 契约，不消耗模型额度。本机已验证两区域 CLI 均能返回模型目录；中国版在未注入 PAT 时完成真实 ACP 请求并返回 OK。国际版此前真实推理无进展超时，尚不能声明端到端推理验证通过。

## 参考与许可

- [dsh-codebuddy-link](https://github.com/liubaicai/dsh-codebuddy-link)：DSH 适配器、插件包装、工具响应解析和调度。
- [dsh-subagent](https://github.com/1373700184/dsh-subagent)：Qoder 双版本 CLI、stdin/stream-json 调用方式。
- [国际版 ACP](https://docs.qoder.com/cli/acp)、[中国版 ACP](https://docs.qoder.cn/cli/acp)、[Qoder CLI 参考](https://docs.qoder.com/cli/cli-reference)。

代码使用 MIT 许可，保留上游版权与 NOTICE。Qoder 名称和 logo 属于其权利人；这是社区插件，不是官方产品。logo 使用用户指定的[原始图片](https://img.alicdn.com/imgextra/i4/O1CN012JUQmkuk4LH0cGga_!!6000000004828-2-tps-304-304.png)。
