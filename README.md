<p align="center"><img src="assets/qoder.png" width="88" alt="Qoder logo"></p>
<h1 align="center">Qoder Link for DSH</h1>
<p align="center">通过官方 Qoder CLI 连接 DSH 对话、模型选择和工具调用。</p>

支持 **qodercli 国际版** 和 **qoderclicn 中国版**，通过原生 **ACP stdio** 接入。在设置中选择版本、管理 PAT 多账户、切换固定账户或账户池；两个区域的账户与可执行文件路径相互独立。无需逆向模型 API。尚未在插件中管理账户的区域可以继续使用该 CLI 自身的登录。

## 功能

- 模型提供商 `qoder`，默认入口 `qoder/default`，支持配置账户可用的模型 ID。
- `qoder_ask` 独立委派工具，不发送当前 DSH 历史，不切换当前模型。
- DSH 历史、系统提示词和工具结果转为完整上下文；工具调用交回 DSH 校验和执行。
- ACP 初始化、会话创建、提示请求、流式文字和思考、工具状态、取消与进程清理；用量仅在 CLI 返回时报告。
- 进程级 FIFO 并发队列、排队超时、无进展超时与取消；持续产生进展的任务不会因超过固定十分钟被终止。最近调用仅保存运行元数据。
- 参照 CodeBuddy Link 的 Web 设置布局，包含账户、模型、最近调用及高级设置。
- PAT 多账户添加、替换、重命名、启停与删除，支持固定账户和按负载选择的账户池；国际版与中国版隔离，令牌不回传浏览器。
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

两个 CLI 的账户、服务区域和配置独立。可在运行 DSH 的同一操作系统账户中完成 CLI 登录，也可在插件的账户区域添加 PAT：

- 国际版：[获取 PAT](https://qoder.com/account/integrations)，子进程使用 `QODER_PERSONAL_ACCESS_TOKEN`。
- 中国版：[获取 PAT](https://qoder.cn/account/integrations)，子进程使用 `QODERCN_PERSONAL_ACCESS_TOKEN`。

托管账户令牌仅注入对应请求的子进程，不改写 CLI 登录文件，不修改 DSH 进程的环境变量。插件保存 PAT 不等于验证成功，实际认证由 CLI 完成。不要把令牌填进路径或模型字段，也不要提交到代码仓库。

## 2. 安装插件

需要支持第三方模型适配器与 Web 插槽的 DSH，Node.js 22.18 或更高版本。

```sh
dsh plugin --profile web add /absolute/path/dsh-qoder-link-0.1.0.tgz
```

Windows 示例：

```powershell
dsh plugin --profile web add D:\Code\Github\dsh-qoder-link\dsh-qoder-link-0.1.0.tgz
```

也可在支持本地插件包的 DSH 插件管理界面选择 `.tgz`。按 DSH 提示重载插件或重启，刷新 Web 页面。

## 3. 配置并使用

打开 **设置 → Qoder Link**（也可从插件行的配置入口打开）：

1. 选择 `qodercli` 国际版或 `qoderclicn` 中国版。
2. 两个路径分开填写；留空时从 PATH 查找对应命令。路径是可执行文件，不是带参数的整条命令。
3. 在账户区域添加当前版本的 PAT。选择固定账户，或启用账户池；账户池只从当前区域启用的账户中选择。替换 PAT 不会在界面显示旧令牌。
4. 根据该 CLI 的 `--list-models` 输出填写模型 ID，并选择默认模型。`default` 使用 CLI 自身默认值。切换版本后请确认模型在该区域账户可用。
5. 保存，在 DSH 模型选择器中选择 `qoder/default` 或配置的具体模型。

一个区域一旦使用过插件托管账户，即使删除全部账户、停用或取消选择，也不会悄悄退回 CLI 本地登录。请重新添加并选择可用账户。运行中的请求使用启动时的账户；后续请求使用最新配置。

每个账户最多同时运行一个请求，账户池优先选择空闲账户并轮询。当前先进入全局并发槽、再等待账户，因此繁忙固定账户可能暂时阻塞其他账户；账户等待期间显示“排队中”，队列位置 0 仅表示已离开全局队列，不表示无需等待。

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

账户凭据独立保存在同目录的 `accounts.json`，不混入普通配置，状态接口仅返回账户元数据。文件以受限权限原子写入，但不是加密保险库；Windows 部署还应限制该目录的 NTFS 访问权限。备份时按敏感凭据处理。

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

自动测试使用假 ACP CLI 验证 JSON-RPC 握手、流式更新、权限拒绝、取消、无进展超时、进程清理及失败路径，并验证账户持久化、区域隔离、调度和 Web/UI 契约，不消耗模型额度。开发机器已验证 qodercli 和 qoderclicn 1.1.80 均能完成 ACP 初始化及会话创建。真实付费推理和多账户认证需在对应登录环境验收，不能由离线测试替代。

## 参考与许可

- [dsh-codebuddy-link](https://github.com/liubaicai/dsh-codebuddy-link)：DSH 适配器、插件包装、工具响应解析和调度。
- [dsh-subagent](https://github.com/1373700184/dsh-subagent)：Qoder 双版本 CLI、stdin/stream-json 调用方式。
- [国际版 ACP](https://docs.qoder.com/cli/acp)、[中国版 ACP](https://docs.qoder.cn/cli/acp)、[Qoder CLI 参考](https://docs.qoder.com/cli/cli-reference)。

代码使用 MIT 许可，保留上游版权与 NOTICE。Qoder 名称和 logo 属于其权利人；这是社区插件，不是官方产品。logo 使用用户指定的[原始图片](https://img.alicdn.com/imgextra/i4/O1CN012JUQmkuk4LH0cGga_!!6000000004828-2-tps-304-304.png)。
