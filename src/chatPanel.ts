import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ChatMessage, KimiApiError, streamChat } from './kimiClient';

const DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1';
const DEFAULT_MODEL = 'kimi-k3';

interface WebviewIncomingMessage {
  type: 'send' | 'stop' | 'copy' | 'openSettings' | 'setApiKey';
  messages?: ChatMessage[];
  model?: string;
  reasoningEffort?: string;
  text?: string;
}

export class ChatPanel {
  static current: ChatPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private abortController: AbortController | undefined;
  private busy = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      'kimiK3.chat',
      'Kimi K3',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => {
      this.abortController?.abort();
      if (ChatPanel.current === this) {
        ChatPanel.current = undefined;
      }
    });

    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });

    ChatPanel.current = this;
  }

  static createOrShow(context: vscode.ExtensionContext): ChatPanel {
    if (ChatPanel.current) {
      ChatPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return ChatPanel.current;
    }
    return new ChatPanel(context);
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  startConversation(messages: ChatMessage[]): void {
    this.post({ type: 'start', messages, replace: true });
  }

  clearConversation(): void {
    this.post({ type: 'clear' });
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private async handleMessage(message: unknown): Promise<void> {
    const msg = message as WebviewIncomingMessage;
    switch (msg.type) {
      case 'send': {
        if (this.busy || !Array.isArray(msg.messages) || msg.messages.length === 0) {
          return;
        }
        await this.doSend(msg.messages, msg.model, msg.reasoningEffort);
        break;
      }
      case 'stop':
        this.abortController?.abort();
        break;
      case 'copy':
        if (typeof msg.text === 'string') {
          await vscode.env.clipboard.writeText(msg.text);
        }
        break;
      case 'openSettings':
        void vscode.commands.executeCommand('workbench.action.openSettings', 'kimiK3');
        break;
      case 'setApiKey':
        void vscode.commands.executeCommand('kimiK3.setApiKey');
        break;
    }
  }

  private async doSend(
    messages: ChatMessage[],
    modelOverride?: string,
    effortOverride?: string
  ): Promise<void> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      this.post({
        type: 'error',
        message: '还没有配置 API Key。请点击聊天面板右上角的“🔑”按钮，或运行命令“Kimi K3: 设置 API Key”。',
      });
      return;
    }

    const cfg = vscode.workspace.getConfiguration('kimiK3');
    const baseUrl = cfg.get<string>('baseUrl') ?? DEFAULT_BASE_URL;
    const model = modelOverride || cfg.get<string>('model') || DEFAULT_MODEL;
    const isK3 = model === 'kimi-k3' || model === 'kimi-k3[1m]';
    const reasoningEffort = isK3
      ? ((effortOverride || cfg.get<string>('reasoningEffort') || 'max') as
          | 'low'
          | 'high'
          | 'max')
      : undefined;
    const maxTokens = cfg.get<number>('maxTokens') ?? 8192;
    const systemPrompt = cfg.get<string>('systemPrompt') ?? '';

    const fullMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    this.busy = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      await streamChat(
        { apiKey, baseUrl, model, reasoningEffort, maxTokens },
        fullMessages,
        signal,
        {
          onReasoning: (text) => this.post({ type: 'delta', kind: 'reasoning', text }),
          onContent: (text) => this.post({ type: 'delta', kind: 'content', text }),
        }
      );
      this.post({ type: 'done' });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.post({ type: 'stopped' });
      } else if (error instanceof KimiApiError) {
        let message = error.message;
        if (error.status === 404) {
          message +=
            '\n\n提示：这是“模型未找到或没有权限”。请依次检查：' +
            '1) 账号是否已充值（K3 需充值解锁，赠券不可用）；' +
            '2) API Key 与接口地址是否属于同一平台（中国站用 api.moonshot.cn，国际站用 api.moonshot.ai）；' +
            '3) 高速版模型可能未对当前账号开放，可先切换标准版 kimi-k2.7-code 或 kimi-k2.6 试试。';
        }
        this.post({ type: 'error', message });
      } else if (error instanceof Error) {
        this.post({ type: 'error', message: error.message });
      } else {
        this.post({ type: 'error', message: String(error) });
      }
    } finally {
      this.busy = false;
      this.abortController = undefined;
    }
  }

  private async resolveApiKey(): Promise<string | undefined> {
    const stored = await this.context.secrets.get('kimiK3.apiKey');
    if (stored && stored.trim()) {
      return stored.trim();
    }
    const env = process.env.MOONSHOT_API_KEY;
    if (env && env.trim()) {
      return env.trim();
    }
    return undefined;
  }

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kimi K3</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      display: flex; flex-direction: column; margin: 0; height: 100vh;
      background: var(--vscode-editor-background); color: var(--vscode-foreground);
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    header {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px;
      background: var(--vscode-editorWidget-background);
      border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0;
    }
    .brand { font-weight: 600; margin-right: 4px; white-space: nowrap; }
    .brand b { color: var(--vscode-charts-purple, #b180d7); }
    select {
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
      padding: 3px 6px; font-size: 12px; max-width: 150px;
    }
    .spacer { flex: 1; }
    button {
      background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
      border: none; border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 12px;
    }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.danger { background: var(--vscode-errorForeground, #f14c4c); color: #fff; }
    button.icon { padding: 5px 7px; }
    button:disabled { opacity: 0.5; cursor: default; }
    main { flex: 1; overflow-y: auto; padding: 8px 0; }
    #welcome {
      height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: var(--vscode-descriptionForeground); text-align: center; padding: 24px; gap: 8px;
    }
    #welcome .big { font-size: 40px; }
    .message { display: flex; margin: 10px 12px; }
    .message.user { justify-content: flex-end; }
    .bubble {
      max-width: 86%; padding: 10px 12px; border-radius: 10px;
      overflow-wrap: break-word; word-break: break-word;
    }
    .message.user .bubble {
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    }
    .message.assistant .bubble {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
    }
    .message.assistant .bubble.error { border-color: var(--vscode-errorForeground, #f14c4c); }
    .bubble p { margin: 6px 0; }
    .bubble p:first-child { margin-top: 0; }
    .bubble p:last-child { margin-bottom: 0; }
    .bubble h1, .bubble h2, .bubble h3, .bubble h4, .bubble h5, .bubble h6 { margin: 10px 0 6px; }
    .bubble ul, .bubble ol { margin: 6px 0; padding-left: 22px; }
    .bubble li { margin: 2px 0; }
    .bubble blockquote {
      margin: 6px 0; padding: 2px 12px; border-left: 3px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
    }
    .bubble hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 10px 0; }
    .bubble pre {
      background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border);
      border-radius: 6px; padding: 10px; overflow-x: auto; margin: 8px 0;
    }
    .bubble code {
      font-family: var(--vscode-editor-font-family); font-size: 12px;
      background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px;
    }
    .bubble pre code { background: none; padding: 0; display: block; white-space: pre; }
    .bubble pre .lang { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .bubble a { color: var(--vscode-textLink-foreground); }
    details.reasoning {
      margin-bottom: 8px; border: 1px dashed var(--vscode-panel-border); border-radius: 6px; padding: 6px 10px;
    }
    details.reasoning summary {
      cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 12px; user-select: none;
    }
    .reasoning-body { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .meta { margin-top: 8px; text-align: right; }
    .meta button { padding: 2px 8px; font-size: 11px; }
    .attached-img { max-width: 180px; max-height: 180px; border-radius: 6px; display: block; margin-top: 6px; }
    footer { flex-shrink: 0; border-top: 1px solid var(--vscode-panel-border); padding: 8px 12px; background: var(--vscode-editorWidget-background); }
    #input {
      width: 100%; resize: none; min-height: 54px; max-height: 200px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
      padding: 8px 10px; font-family: inherit; font-size: 13px; outline: none;
    }
    #input:focus { border-color: var(--vscode-focusBorder); }
    .toolbar { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    #attachments { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    .attachment { position: relative; display: inline-block; }
    .thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; border: 1px solid var(--vscode-panel-border); }
    .attachment .remove {
      position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; padding: 0;
      border-radius: 50%; font-size: 12px; line-height: 1; background: var(--vscode-errorForeground, #f14c4c); color: #fff;
    }
    .status { min-height: 16px; margin-top: 6px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .status.error { color: var(--vscode-errorForeground, #f14c4c); }
  </style>
</head>
<body>
  <header>
    <div class="brand">Kimi <b>K3</b></div>
    <select id="model" title="模型">
      <option value="kimi-k3">kimi-k3</option>
      <option value="kimi-k2.7-code">kimi-k2.7-code</option>
      <option value="kimi-k2.7-code-highspeed">kimi-k2.7-code-highspeed</option>
      <option value="kimi-k2.6">kimi-k2.6</option>
    </select>
    <select id="effort" title="推理强度">
      <option value="max">推理：max</option>
      <option value="high">推理：high</option>
      <option value="low">推理：low</option>
    </select>
    <div class="spacer"></div>
    <button id="newChat" class="icon" title="新对话">+</button>
    <button id="keyBtn" class="icon" title="设置 API Key">🔑</button>
    <button id="settingsBtn" class="icon" title="打开设置">⚙</button>
  </header>
  <main id="messages">
    <div id="welcome">
      <div class="big">🤖</div>
      <div><b>Kimi K3 助手</b></div>
      <div>在下方输入问题，或选中代码后右键选择“Kimi K3”操作。</div>
      <div>支持多轮对话、流式输出、思考过程与图片输入。</div>
    </div>
  </main>
  <footer>
    <div id="attachments"></div>
    <textarea id="input" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
    <div class="toolbar">
      <button id="attachBtn" title="添加图片（K3 支持视觉理解）">🖼 图片</button>
      <div class="spacer"></div>
      <button id="stopBtn" class="danger" hidden>停止</button>
      <button id="sendBtn" class="primary">发送</button>
    </div>
    <div id="status"></div>
  </footer>
  <input type="file" id="fileInput" accept="image/*" multiple hidden>
  <script nonce="${nonce}">
    (function () {
      var vscode = acquireVsCodeApi();
      var saved = vscode.getState() || {};
      var messages = Array.isArray(saved.messages) ? saved.messages : [];
      var streaming = false;
      var reasoningBuffer = '';
      var contentBuffer = '';
      var assistantEl = null;
      var reasoningEl = null;
      var contentEl = null;
      var rafPending = false;
      var imageQueue = [];

      var modelSel = document.getElementById('model');
      var effortSel = document.getElementById('effort');
      var input = document.getElementById('input');
      var sendBtn = document.getElementById('sendBtn');
      var stopBtn = document.getElementById('stopBtn');
      var attachBtn = document.getElementById('attachBtn');
      var messagesEl = document.getElementById('messages');
      var welcomeEl = document.getElementById('welcome');
      var statusEl = document.getElementById('status');
      var attachmentsEl = document.getElementById('attachments');
      var fileInput = document.getElementById('fileInput');

      if (saved.model) modelSel.value = saved.model;
      if (saved.effort) effortSel.value = saved.effort;

      function saveState() {
        vscode.setState({ messages: messages, model: modelSel.value, effort: effortSel.value });
      }

      function status(text, isError) {
        statusEl.textContent = text || '';
        statusEl.className = 'status' + (isError ? ' error' : '');
      }

      function escapeHtml(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function renderInline(text) {
        return text
          .replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>')
          .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
          .replace(/\\*([^*\\n]+)\\*/g, '<em>$1</em>')
          .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      }

      function renderBlocks(text) {
        var lines = text.split('\\n');
        var out = '';
        var paragraph = [];
        var listType = '';

        function flushParagraph() {
          if (paragraph.length) {
            out += '<p>' + paragraph.join('<br>') + '</p>';
            paragraph = [];
          }
        }
        function closeList() {
          if (listType) {
            out += '</' + listType + '>';
            listType = '';
          }
        }

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (/^\\s*$/.test(line)) {
            closeList();
            flushParagraph();
            continue;
          }
          var heading = line.match(/^(#{1,6})\\s+(.*)$/);
          if (heading) {
            closeList();
            flushParagraph();
            out += '<h' + heading[1].length + '>' + heading[2] + '</h' + heading[1].length + '>';
            continue;
          }
          var list = line.match(/^(\\s*)([-*+]|\\d+\\.)\\s+(.*)$/);
          if (list) {
            flushParagraph();
            var type = /^\\d+\\.$/.test(list[2]) ? 'ol' : 'ul';
            if (listType !== type) {
              closeList();
              out += '<' + type + '>';
              listType = type;
            }
            out += '<li>' + list[3] + '</li>';
            continue;
          }
          closeList();
          if (/^&gt;\\s?/.test(line)) {
            flushParagraph();
            out += '<blockquote>' + line.replace(/^&gt;\\s?/, '') + '</blockquote>';
            continue;
          }
          if (/^[-*_]{3,}\\s*$/.test(line)) {
            flushParagraph();
            out += '<hr>';
            continue;
          }
          paragraph.push(line);
        }
        closeList();
        flushParagraph();
        return out;
      }

      function renderMarkdown(text) {
        var parts = String(text || '').split(/(\`\`\`[\\s\\S]*?\`\`\`)/g);
        var html = '';
        for (var i = 0; i < parts.length; i++) {
          var part = parts[i];
          if (part.indexOf('\`\`\`') === 0) {
            var inner = part.slice(3);
            var nl = inner.indexOf('\\n');
            var lang = nl === -1 ? '' : inner.slice(0, nl).trim();
            var code = nl === -1 ? inner : inner.slice(nl + 1);
            code = code.replace(/\`\`\`$/, '').replace(/\\n$/, '');
            html += '<pre><code>' + (lang ? '<span class="lang">' + lang + '</span>\\n' : '') + code + '</code></pre>';
          } else {
            html += renderInline(renderBlocks(escapeHtml(part)));
          }
        }
        return html;
      }

      function makeImage(part) {
        var img = document.createElement('img');
        img.src = part.image_url && part.image_url.url ? part.image_url.url : '';
        img.className = 'attached-img';
        return img;
      }

      function renderMessage(msg) {
        var wrap = document.createElement('div');
        wrap.className = 'message ' + msg.role;
        var bubble = document.createElement('div');
        bubble.className = 'bubble';

        if (msg.role === 'user') {
          if (Array.isArray(msg.content)) {
            msg.content.forEach(function (part) {
              if (part.type === 'text') {
                var textDiv = document.createElement('div');
                textDiv.innerHTML = renderMarkdown(part.text);
                bubble.appendChild(textDiv);
              } else if (part.type === 'image_url') {
                bubble.appendChild(makeImage(part));
              }
            });
          } else {
            bubble.innerHTML = renderMarkdown(msg.content);
          }
        } else {
          if (msg.reasoning) {
            var details = document.createElement('details');
            details.className = 'reasoning';
            var summary = document.createElement('summary');
            summary.textContent = '思考过程';
            var body = document.createElement('div');
            body.className = 'reasoning-body';
            body.innerHTML = renderMarkdown(msg.reasoning);
            details.appendChild(summary);
            details.appendChild(body);
            bubble.appendChild(details);
          }
          var contentDiv = document.createElement('div');
          contentDiv.innerHTML = renderMarkdown(msg.content);
          bubble.appendChild(contentDiv);
          var meta = document.createElement('div');
          meta.className = 'meta';
          var copyBtn = document.createElement('button');
          copyBtn.textContent = '复制';
          copyBtn.addEventListener('click', function () {
            vscode.postMessage({ type: 'copy', text: String(msg.content || '') });
            status('已复制');
          });
          meta.appendChild(copyBtn);
          bubble.appendChild(meta);
        }
        wrap.appendChild(bubble);
        return wrap;
      }

      function renderAll() {
        messagesEl.innerHTML = '';
        welcomeEl.style.display = messages.length ? 'none' : 'flex';
        messages.forEach(function (m) {
          messagesEl.appendChild(renderMessage(m));
        });
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      function beginAssistant() {
        streaming = true;
        reasoningBuffer = '';
        contentBuffer = '';
        assistantEl = document.createElement('div');
        assistantEl.className = 'message assistant';
        var bubble = document.createElement('div');
        bubble.className = 'bubble';
        var details = document.createElement('details');
        details.className = 'reasoning';
        details.open = true;
        var summary = document.createElement('summary');
        summary.textContent = '思考中…';
        reasoningEl = document.createElement('div');
        reasoningEl.className = 'reasoning-body';
        reasoningEl.innerHTML = '<span>…</span>';
        details.appendChild(summary);
        details.appendChild(reasoningEl);
        contentEl = document.createElement('div');
        contentEl.className = 'content';
        bubble.appendChild(details);
        bubble.appendChild(contentEl);
        assistantEl.appendChild(bubble);
        messagesEl.appendChild(assistantEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      function scheduleRender() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function () {
          rafPending = false;
          if (!streaming || !assistantEl) return;
          if (reasoningBuffer) {
            reasoningEl.innerHTML = renderMarkdown(reasoningBuffer);
            reasoningEl.parentElement.querySelector('summary').textContent = '思考过程';
          }
          contentEl.innerHTML = renderMarkdown(contentBuffer);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        });
      }

      function teardownAssistant() {
        if (assistantEl && assistantEl.parentNode) {
          assistantEl.parentNode.removeChild(assistantEl);
        }
        assistantEl = null;
        reasoningEl = null;
        contentEl = null;
      }

      function updateBusyUI() {
        sendBtn.disabled = streaming;
        stopBtn.hidden = !streaming;
        input.disabled = streaming;
        attachBtn.disabled = streaming;
      }

      function finishAssistant(stopped) {
        if (!streaming || !assistantEl) {
          streaming = false;
          updateBusyUI();
          return;
        }
        var hasContent = !!(contentBuffer || reasoningBuffer);
        if (hasContent) {
          messages.push({
            role: 'assistant',
            content: contentBuffer,
            reasoning: reasoningBuffer || undefined
          });
        }
        teardownAssistant();
        streaming = false;
        updateBusyUI();
        saveState();
        renderAll();
        if (stopped) status('已停止');
      }

      function currentContent(text) {
        var parts = [];
        if (text) parts.push({ type: 'text', text: text });
        for (var i = 0; i < imageQueue.length; i++) {
          parts.push({ type: 'image_url', image_url: { url: imageQueue[i] } });
        }
        if (parts.length === 0) return '';
        if (parts.length === 1 && parts[0].type === 'text') return text;
        return parts;
      }

      function doSend(providedMessages) {
        if (streaming) return;
        var history;
        if (providedMessages) {
          messages = providedMessages;
          history = messages;
          saveState();
          renderAll();
        } else {
          var text = input.value.trim();
          var content = currentContent(text);
          if (!content) {
            status('请输入内容或添加图片', true);
            return;
          }
          messages.push({ role: 'user', content: content });
          input.value = '';
          imageQueue = [];
          renderAttachments();
          saveState();
          renderAll();
          history = messages;
        }
        beginAssistant();
        updateBusyUI();
        status('等待响应…');
        var payload = history.map(function (m) {
          return { role: m.role, content: m.content };
        });
        vscode.postMessage({
          type: 'send',
          messages: payload,
          model: modelSel.value,
          reasoningEffort: effortSel.value
        });
      }

      function renderAttachments() {
        attachmentsEl.innerHTML = '';
        imageQueue.forEach(function (src, i) {
          var wrap = document.createElement('div');
          wrap.className = 'attachment';
          var img = document.createElement('img');
          img.src = src;
          img.className = 'thumb';
          var removeBtn = document.createElement('button');
          removeBtn.textContent = '×';
          removeBtn.className = 'remove';
          removeBtn.title = '移除';
          removeBtn.addEventListener('click', function () {
            imageQueue.splice(i, 1);
            renderAttachments();
          });
          wrap.appendChild(img);
          wrap.appendChild(removeBtn);
          attachmentsEl.appendChild(wrap);
        });
      }

      function showError(message) {
        var wrap = document.createElement('div');
        wrap.className = 'message assistant';
        var bubble = document.createElement('div');
        bubble.className = 'bubble error';
        bubble.innerHTML = renderMarkdown(message);
        wrap.appendChild(bubble);
        messagesEl.appendChild(wrap);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        status('出错了', true);
      }

      sendBtn.addEventListener('click', function () { doSend(); });
      stopBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'stop' });
        status('正在停止…');
      });
      attachBtn.addEventListener('click', function () { fileInput.click(); });
      document.getElementById('newChat').addEventListener('click', function () {
        messages = [];
        imageQueue = [];
        saveState();
        renderAll();
        status('');
      });
      document.getElementById('keyBtn').addEventListener('click', function () {
        vscode.postMessage({ type: 'setApiKey' });
      });
      document.getElementById('settingsBtn').addEventListener('click', function () {
        vscode.postMessage({ type: 'openSettings' });
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          doSend();
        }
      });
      fileInput.addEventListener('change', function () {
        for (var i = 0; i < fileInput.files.length; i++) {
          var file = fileInput.files[i];
          if (!file.type || file.type.indexOf('image/') !== 0) continue;
          if (file.size > 10 * 1024 * 1024) {
            status('图片过大：请选择 10MB 以内的图片', true);
            continue;
          }
          (function (f) {
            var reader = new FileReader();
            reader.onload = function () {
              imageQueue.push(String(reader.result));
              renderAttachments();
            };
            reader.readAsDataURL(f);
          })(file);
        }
        fileInput.value = '';
      });

      window.addEventListener('message', function (event) {
        var msg = event.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'start') {
          if (msg.replace) {
            messages = msg.messages || [];
            imageQueue = [];
            saveState();
            renderAll();
          }
          beginAssistant();
          updateBusyUI();
          status('等待响应…');
        } else if (msg.type === 'delta') {
          if (!streaming) beginAssistant();
          if (msg.kind === 'reasoning') reasoningBuffer += msg.text;
          else contentBuffer += msg.text;
          scheduleRender();
        } else if (msg.type === 'done') {
          finishAssistant(false);
          status('');
        } else if (msg.type === 'stopped') {
          finishAssistant(true);
        } else if (msg.type === 'error') {
          if (streaming) {
            var hadContent = !!(contentBuffer || reasoningBuffer);
            if (hadContent) {
              messages.push({
                role: 'assistant',
                content: contentBuffer,
                reasoning: reasoningBuffer || undefined
              });
            }
            teardownAssistant();
            streaming = false;
            updateBusyUI();
            saveState();
          }
          showError(msg.message || '未知错误');
        } else if (msg.type === 'clear') {
          messages = [];
          imageQueue = [];
          saveState();
          renderAll();
          status('对话已清空');
        }
      });

      renderAll();
      updateBusyUI();
    })();
  </script>
</body>
</html>`;
  }
}
