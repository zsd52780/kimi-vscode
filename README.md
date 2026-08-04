# Kimi 助手（VS Code 插件）

在 VS Code 中通过官方 API 使用 [Kimi](https://platform.kimi.com/docs/) 模型。支持多轮聊天、流式输出、思考过程展示、代码上下文操作和图片输入。

## 功能

- **聊天面板**：打开独立面板与 Kimi K3 多轮对话，回复流式显示，思考过程可折叠查看
- **代码操作**：选中代码后通过右键菜单一键「解释 / 审查 / 重构 / 生成测试」
- **询问文件**：在编辑器标题栏右键菜单中选择，把整个文件作为上下文提问
- **图片输入**：聊天面板中可添加本地图片，利用 K3 的视觉理解能力
- **灵活配置**：可切换模型（kimi-k3 / kimi-k2.7-code / kimi-k2.7-code-highspeed / kimi-k2.6）和推理强度（low / high / max，仅 K3 生效）

## 前置条件

1. 在 [Kimi API 开放平台](https://platform.kimi.com) 注册并创建 API Key
2. 注意：Kimi K3 为旗舰模型，需要平台充值后才能调用（最低充值 10 元）；新用户赠送的代金券不可用于 K3
3. VS Code 1.85 及以上版本

## 安装

### 方式一：安装打包文件（VSIX）

```bash
npm install
npm run compile
npx @vscode/vsce package --no-dependencies
```

然后在 VS Code 中：扩展面板 → 右上角 `...` → **从 VSIX 安装…**，选择生成的 `kimi-k3-assistant-0.1.0.vsix`。

### 方式二：F5 调试运行

```bash
npm install
npm run compile
```

然后按 `F5` 打开扩展开发宿主窗口。

## 配置 API Key

首次使用时运行命令 **Kimi K3: 设置 API Key**（或点击聊天面板右上角 🔑），输入你的 API Key。Key 会保存在 VS Code 的安全存储中，不会写入项目文件。

也可以设置环境变量 `MOONSHOT_API_KEY` 作为替代。

## 使用

1. 命令面板（`Cmd+Shift+P` / `Ctrl+Shift+P`）运行 **Kimi K3: 打开聊天面板**
2. 在输入框提问，`Enter` 发送、`Shift+Enter` 换行
3. 选中代码后右键，在 **Kimi K3** 分组中选择操作
4. 点击 🖼 按钮可附加本地图片

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `kimiK3.baseUrl` | `https://api.moonshot.cn/v1` | Kimi API 基础地址 |
| `kimiK3.model` | `kimi-k3` | 默认模型（含标准版 `kimi-k2.7-code` 与高速版 `kimi-k2.7-code-highspeed`） |
| `kimiK3.reasoningEffort` | `max` | 推理强度（K3 始终开启思考） |
| `kimiK3.maxTokens` | `8192` | 单次回复最大输出 token 数 |
| `kimiK3.systemPrompt` | 内置提示词 | 系统提示词 |

## 项目结构

```text
src/
  extension.ts   插件入口与命令注册
  chatPanel.ts   聊天面板（Webview 界面）
  kimiClient.ts  Kimi API 流式调用客户端
```

## 常见问题

- **提示未配置 API Key**：运行「Kimi K3: 设置 API Key」命令，或设置 `MOONSHOT_API_KEY` 环境变量。
- **404 模型未找到或没有权限**：先确认账号已充值（K3 需充值解锁，赠券不可用）；再确认 API Key 与接口地址属于同一平台（中国站 `api.moonshot.cn`，国际站 `api.moonshot.ai`）；高速版模型可能未对当前账号开放，可先切换到标准版 `kimi-k2.7-code` 或 `kimi-k2.6`。
- **403 / 余额不足**：前往开放平台检查账户余额与限速。
- **回复很慢**：K3 始终开启思考模式，可在聊天面板或设置中把推理强度调为 `low`。
- **多轮对话丢失上下文**：聊天面板会自动携带完整历史；工具调用等高级场景请参考官方文档中「原样回传完整 assistant message」的要求。

## 说明

这个项目全部由ai编写,注意安全！

本项目仅作为 Kimi 官方 API 的客户端，所有请求直接发送到 `https://api.moonshot.cn/v1`，不经过任何中转服务器。API Key 仅保存在本机 VS Code 安全存储中。
