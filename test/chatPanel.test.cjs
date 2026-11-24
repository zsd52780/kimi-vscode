const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.style = {};
    this._value = '';
    this._innerHTML = '';
    this.disabled = false;
    this.hidden = false;
  }

  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    this.children.push(child);
    child.parentElement = this;
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentElement = null;
    child.parentNode = null;
    return child;
  }

  get options() {
    return this.children.filter((child) => child.tagName === 'option');
  }

  set value(value) {
    if (this.tagName === 'select') {
      this._value = this.options.some((option) => option.value === value) ? value : '';
    } else {
      this._value = value;
    }
  }

  get value() {
    return this._value;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(name, listener) {
    (this.listeners[name] ||= []).push(listener);
  }

  dispatch(name, event = {}) {
    for (const listener of this.listeners[name] || []) listener(event);
  }

  querySelector(selector) {
    if (selector === 'summary') {
      return this.children.find((child) => child.tagName === 'summary') || null;
    }
    return null;
  }
}

function createDocument() {
  const elements = new Map();
  for (const id of ['model', 'effort', 'input', 'sendBtn', 'stopBtn', 'attachBtn',
    'messages', 'welcome', 'status', 'attachments', 'fileInput', 'newChat',
    'keyBtn', 'settingsBtn']) {
    const tag = id === 'model' || id === 'effort' ? 'select' : 'div';
    elements.set(id, new Element(tag));
  }
  for (const value of ['max', 'high', 'low']) {
    const option = new Element('option');
    option.value = value;
    elements.get('effort').appendChild(option);
  }
  return {
    elements,
    getElementById(id) { return elements.get(id); },
    createElement(tagName) { return new Element(tagName); },
  };
}

function createHarness({ configuredModel = 'kimi-k3.1-pro', configuredEffort = 'high', saved = {}, beforeReady } = {}) {
  const settings = {
    model: configuredModel,
    reasoningEffort: configuredEffort,
    baseUrl: 'https://api.moonshot.cn/v1',
    maxTokens: 8192,
    systemPrompt: 'You are a programming assistant.',
  };
  let configListener;
  let incomingListener;
  let pageListener;
  let webviewState = saved;
  const requests = [];
  const sentFromPage = [];
  const postedToPage = [];
  const document = createDocument();
  const webview = {
    html: '',
    onDidReceiveMessage(listener) { incomingListener = listener; },
    postMessage(message) {
      postedToPage.push(message);
      if (pageListener) pageListener({ data: message });
      return Promise.resolve(true);
    },
  };
  const vscode = {
    ViewColumn: { Beside: 2 },
    workspace: {
      getConfiguration() { return { get(key) { return settings[key]; } }; },
      onDidChangeConfiguration(listener) {
        configListener = listener;
        return { dispose() {} };
      },
    },
    window: {
      createWebviewPanel() {
        return { webview, reveal() {}, onDidDispose() {} };
      },
    },
    commands: { executeCommand() {} },
    env: { clipboard: { writeText() {} } },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.apply(this, arguments);
  };
  let ChatPanel;
  try {
    const file = path.resolve(__dirname, '../dist/chatPanel.js');
    delete require.cache[file];
    ({ ChatPanel } = require(file));
  } finally {
    Module._load = originalLoad;
  }
  const panel = new ChatPanel({ secrets: { get: async () => 'test-api-key' } });
  if (beforeReady) beforeReady(panel);
  const script = webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'generated Webview contains inline script');
  const pageApi = {
    getState() { return webviewState; },
    setState(state) { webviewState = state; },
    postMessage(message) {
      sentFromPage.push(message);
      incomingListener(message);
    },
  };
  vm.runInNewContext(script, {
    document,
    window: { addEventListener(name, listener) { if (name === 'message') pageListener = listener; } },
    acquireVsCodeApi() { return pageApi; },
    requestAnimationFrame(callback) { callback(); },
  }, { filename: 'kimi-webview.js' });

  return {
    panel,
    document,
    settings,
    requests,
    sentFromPage,
    postedToPage,
    get saved() { return webviewState; },
    sendFromExtension(message) { pageListener({ data: message }); },
    changeSetting(key, value) {
      settings[key] = value;
      configListener({ affectsConfiguration(path) { return path === `kimiK3.${key}`; } });
    },
    mockFetch(sse = 'data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n') {
      const originalFetch = global.fetch;
      global.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return new Response(sse, {
          headers: { 'content-type': 'text/event-stream' },
        });
      };
      return () => { global.fetch = originalFetch; };
    },
  };
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('first opening uses configured model and effort in the actual request', async () => {
  const app = createHarness({ configuredModel: 'kimi-k3.1-pro-highspeed', configuredEffort: 'low' });
  assert.equal(app.document.getElementById('model').value, 'kimi-k3.1-pro-highspeed');
  assert.equal(app.document.getElementById('effort').value, 'low');
  assert.equal(app.document.getElementById('effort').disabled, false);
  const restoreFetch = app.mockFetch();
  try {
    app.document.getElementById('input').value = 'hello';
    app.document.getElementById('sendBtn').dispatch('click');
    await flushAsync();
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].model, 'kimi-k3.1-pro-highspeed');
    assert.equal(app.requests[0].reasoning_effort, 'low');
  } finally {
    restoreFetch();
  }
});

test('saved model and effort survive reload, and old reasoning is forwarded on follow-up', async () => {
  const app = createHarness({
    saved: {
      model: 'kimi-k3', effort: 'max',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer', reasoning: 'old reasoning' },
      ],
    },
  });
  assert.equal(app.document.getElementById('model').value, 'kimi-k3');
  assert.equal(app.document.getElementById('effort').value, 'max');
  const restoreFetch = app.mockFetch();
  try {
    app.document.getElementById('input').value = 'follow up';
    app.document.getElementById('sendBtn').dispatch('click');
    await flushAsync();
    assert.equal(app.requests[0].messages[2].reasoning_content, 'old reasoning');
    assert.equal(app.requests[0].model, 'kimi-k3');
  } finally {
    restoreFetch();
  }
});

test('streamed reasoning is retained in the next turn sent to the API', async () => {
  const app = createHarness();
  const restoreFetch = app.mockFetch(
    'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"first answer"}}]}\n\n' +
    'data: [DONE]\n\n'
  );
  try {
    app.document.getElementById('input').value = 'first';
    app.document.getElementById('sendBtn').dispatch('click');
    await flushAsync();
    assert.equal(app.saved.messages.at(-1).reasoning_content, 'thinking...');

    app.document.getElementById('input').value = 'second';
    app.document.getElementById('sendBtn').dispatch('click');
    await flushAsync();
    assert.equal(app.requests.length, 2);
    assert.equal(app.requests[1].messages[2].reasoning_content, 'thinking...');
    assert.equal(app.requests[1].messages[2].content, 'first answer');
  } finally {
    restoreFetch();
  }
});

test('custom configured model remains selectable; changed settings replace outdated defaults', () => {
  const custom = createHarness({ configuredModel: 'my-private-model', saved: {} });
  assert.equal(custom.document.getElementById('model').value, 'my-private-model');
  assert.equal(custom.document.getElementById('effort').disabled, true);

  const app = createHarness({
    configuredModel: 'kimi-k3.1-pro', configuredEffort: 'high',
    saved: { model: 'kimi-k3', effort: 'low', configModel: 'kimi-k3', configEffort: 'max' },
  });
  assert.equal(app.document.getElementById('model').value, 'kimi-k3.1-pro');
  assert.equal(app.document.getElementById('effort').value, 'high');
  app.changeSetting('model', 'kimi-k2.7-code');
  assert.equal(app.document.getElementById('model').value, 'kimi-k2.7-code');
  assert.equal(app.document.getElementById('effort').disabled, true);
  app.changeSetting('reasoningEffort', 'low');
  assert.equal(app.document.getElementById('effort').value, 'low');
  assert.equal(app.saved.configModel, 'kimi-k2.7-code');
});

test('model picker persists manual choice and gates reasoning by model capability', () => {
  const app = createHarness();
  const model = app.document.getElementById('model');
  const effort = app.document.getElementById('effort');
  model.value = 'kimi-k2.6';
  model.dispatch('change');
  assert.equal(app.saved.model, 'kimi-k2.6');
  assert.equal(effort.disabled, true);
  model.value = 'kimi-k3.1-pro';
  model.dispatch('change');
  assert.equal(effort.disabled, false);
});

test('selection action starts an API request and preserves code block escaping', async () => {
  const app = createHarness();
  const restoreFetch = app.mockFetch();
  try {
    app.panel.startConversation([{ role: 'user', content: '```js\n<script>alert(1)</script>\n```' }]);
    await flushAsync();
    assert.equal(app.sentFromPage.at(-1).type, 'send');
    assert.equal(app.requests.length, 1);
    const messages = app.document.getElementById('messages');
    const rendered = messages.children[1].children[0].innerHTML;
    assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(rendered, /<script>alert/);
  } finally {
    restoreFetch();
  }
});

test('selection action opened before Webview readiness is sent after the ready handshake', async () => {
  const prompt = 'Explain the selected code';
  const app = createHarness({
    beforeReady(panel) {
      panel.startConversation([{ role: 'user', content: prompt }]);
    },
  });
  const restoreFetch = app.mockFetch();
  try {
    await flushAsync();
    assert.deepEqual(app.sentFromPage.map((message) => message.type), ['ready', 'send']);
    assert.equal(app.postedToPage[0].type, 'start');
    assert.equal(app.postedToPage[0].messages[0].content, prompt);
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].messages[1].content, prompt);
  } finally {
    restoreFetch();
  }
});
