# Kimi 助手（VS Code 插件）

下载地址：[Releases](https://github.com/zsd52780/kimi-vscode/releases)

在 VS Code 中通过官方 API 使用 [Kimi](https://platform.kimi.com/docs/) 模型。支持多轮聊天、流式输出、思考过程展示、代码上下文操作和图片输入。

## 功能

- **聊天面板**：默认使用 Kimi K3.1 Pro 多轮对话，回复流式显示，思考过程可折叠查看并在后续请求中保留
- **代码操作**：选中代码后通过右键菜单一键「解释 / 审查 / 重构 / 生成测试」
- **询问文件**：在编辑器标题栏右键菜单中选择，把整个文件作为上下文提问
- **图片输入**：聊天面板中可添加本地图片，利用 K3.1 Pro / K3 的视觉理解能力
- **灵活配置**：可切换 `kimi-k3.1-pro` / `kimi-k3.1-pro-highspeed` / `kimi-k3`，并调节推理强度（`low` / `high` / `max`）
- **旧模型兼容**：保留 K2.7 Code（含高速版）和 K2.6，推理强度控件对这些型号禁用

## 0.2.0 更新与升级

新增 Kimi K3.1 Pro 标准版及高速版，默认使用 `kimi-k3.1-pro`。修复面板不读取默认模型设置的问题，并让设置中的模型与推理强度变更立即同步到面板。多轮对话会按 API 要求回传 `reasoning_content`，也兼容旧会话保存的思考内容。

安装新版 VSIX 后，已有 API Key、`kimiK3.*` 设置和命令 ID 继续有效；扩展 ID 仍为 `kimi-k3-assistant.kimi-k3-assistant`。已有会话中手动选择的模型会保留，要使用新模型，请在面板顶部切换到 `kimi-k3.1-pro`，或修改 `kimiK3.model` 设置。新会话建议通过 `+` 按钮开始。

截至 **2026-11-24**，官方模型列表将 K3.1 Pro、K3.1 Pro Highspeed 和 K3 列为可用模型；K2.7 Code / K2.6 已停止向新用户提供，2026 年 11 月 1 日前注册的用户仍可使用，预计于 2026 年 12 月底全面下线。插件保留这些选项以兼容旧账号，不能保证账号仍有访问权限。

核对依据：[官方模型列表](https://platform.kimi.com/docs/models.md)、[K3.1 Pro 接入指南](https://platform.kimi.com/docs/guide/kimi-k3-1-pro-quickstart.md)、[模型参数参考](https://platform.kimi.com/docs/api/models-overview.md)、[思考模型与多轮保留](https://platform.kimi.com/docs/guide/use-thinking-models.md)。

## 前置条件

1. 在 [Kimi API 开放平台](https://platform.kimi.com) 注册并创建 API Key
2. 确保 API 账号对所选模型有调用权限和可用额度。充值、代金券与高速版的适用范围以[官方账号说明](https://platform.kimi.com/docs/guide/account-and-payments.md)为准
3. VS Code 1.85 及以上版本

## 安装

### 方式一：安装打包文件（VSIX）

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run package
```

开发环境需要 Node.js 22+（含 npm）和 pnpm。然后在 VS Code 中：扩展面板 → 右上角 `...` → **从 VSIX 安装…**，选择生成的 `kimi-k3-assistant-0.2.0.vsix`。如果已有该版本的 VSIX，可以直接安装，无需先执行构建命令。

### 方式二：F5 调试运行

```bash
pnpm install --frozen-lockfile
pnpm run compile
```

然后在 VS Code 中选择扩展开发宿主调试配置，按 `F5` 打开扩展开发宿主窗口。

## 配置 API Key

首次使用时运行命令 **Kimi: 设置 API Key**（或点击聊天面板右上角 🔑），输入你的 API Key。Key 会保存在 VS Code 的安全存储中，不会写入项目文件。

也可以设置环境变量 `MOONSHOT_API_KEY` 作为替代。

## 使用

1. 命令面板（`Cmd+Shift+P` / `Ctrl+Shift+P`）运行 **Kimi: 打开聊天面板**
2. 在输入框提问，`Enter` 发送、`Shift+Enter` 换行
3. 选中代码后右键，选择 **Kimi: 解释 / 审查 / 重构 / 生成测试** 操作
4. 点击 🖼 按钮可附加本地图片

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `kimiK3.baseUrl` | `https://api.moonshot.cn/v1` | Kimi API 基础地址 |
| `kimiK3.model` | `kimi-k3.1-pro` | 默认模型，面板内也可临时切换并保留选择 |
| `kimiK3.reasoningEffort` | `max` | K3.1 Pro（含高速版）及 K3 的推理强度；这些模型始终开启思考 |
| `kimiK3.maxTokens` | `8192` | 单次回复最大输出 token 数，包含思考和最终回答 |
| `kimiK3.systemPrompt` | 内置提示词 | 系统提示词 |

## 项目结构

```text
src/
  extension.ts   插件入口与命令注册
  chatPanel.ts   聊天面板（Webview 界面）
  kimiClient.ts  Kimi API 流式调用客户端
  models.ts      内置模型列表与推理能力
test/            模型、请求参数与聊天面板回归测试
```

## 常见问题

- **提示未配置 API Key**：运行「Kimi: 设置 API Key」命令，或设置 `MOONSHOT_API_KEY` 环境变量。
- **404 模型未找到或没有权限**：确认账号有当前模型的权限和额度，API Key 与接口地址属于同一平台（中国站 `api.moonshot.cn`，国际站 `api.moonshot.ai`）；高速版不可用时可先切换到标准版 `kimi-k3.1-pro`。K2.7 / K2.6 正在下线，不能作为新账号的回退选项。
- **403 / 余额不足**：前往开放平台检查账户余额与限速。
- **回复很慢**：K3.1 Pro / K3 始终开启思考模式，可在聊天面板或设置中把推理强度调为 `low`。
- **只显示思考或回答被截断**：思考也会占用输出 token 配额，可按需要增大 `kimiK3.maxTokens`，或降低推理强度。
- **多轮对话**：聊天面板会携带历史回答及思考内容；历史思考也会占用上下文并参与计费，较长会话可通过 `+` 开始新对话。插件目前不执行模型工具调用。

## 说明

这个项目全部由ai编写,注意安全！

本项目作为 Kimi 官方 API 的客户端，默认直接请求 `https://api.moonshot.cn/v1`；如果修改 `kimiK3.baseUrl`，请求会发送到所配置的地址。通过设置命令保存的 API Key 位于本机 VS Code 安全存储中，也支持从 `MOONSHOT_API_KEY` 环境变量读取。
