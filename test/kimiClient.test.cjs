const assert = require('node:assert/strict');
const { test } = require('node:test');
const { streamChat, KimiApiError } = require('../dist/kimiClient.js');

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://api.moonshot.cn/v1/',
  model: 'kimi-k3.1-pro',
  reasoningEffort: 'high',
  maxTokens: 8192,
};

function mockResponse(t, response = new Response('data: [DONE]\n', { status: 200 })) {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    request = { url, init };
    return response;
  });
  return () => {
    assert.ok(request, 'the API request was sent');
    return { url: request.url, body: JSON.parse(request.init.body) };
  };
}

test('K3 series sends reasoning effort and preserves assistant reasoning and image content', async (t) => {
  const getRequest = mockResponse(t);
  const image = 'data:image/png;base64,YQ==';
  const messages = [
    { role: 'system', content: 'Be concise', reasoning: 'internal only' },
    { role: 'assistant', content: 'answer', reasoning: 'legacy', reasoning_content: 'canonical' },
    { role: 'assistant', content: 'earlier', reasoning: 'old reasoning' },
    { role: 'user', content: [{ type: 'text', text: 'What is in this image?' }, { type: 'image_url', image_url: { url: image } }] },
  ];
  await streamChat(config, messages, new AbortController().signal, {});
  const { url, body } = getRequest();
  assert.equal(url, 'https://api.moonshot.cn/v1/chat/completions');
  assert.equal(body.model, 'kimi-k3.1-pro');
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.max_completion_tokens, 8192);
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Be concise' },
    { role: 'assistant', content: 'answer', reasoning_content: 'canonical' },
    { role: 'assistant', content: 'earlier', reasoning_content: 'old reasoning' },
    { role: 'user', content: [{ type: 'text', text: 'What is in this image?' }, { type: 'image_url', image_url: { url: image } }] },
  ]);
  assert.equal(Object.hasOwn(messages[1], 'reasoning'), true, 'caller messages are not changed');
});

test('reasoning effort is sent only for documented K3 models', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response('data: [DONE]\n');
  });
  const models = [
    'kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3', 'kimi-k3[1m]',
    'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6',
  ];
  for (const model of models) {
    await streamChat({ ...config, model }, [{ role: 'user', content: 'hi' }], new AbortController().signal, {});
  }
  for (let i = 0; i < requests.length; i++) {
    assert.equal(requests[i].model, models[i]);
    assert.equal(requests[i].reasoning_effort, i < 4 ? 'high' : undefined, models[i]);
  }
});

test('streamed SSE parses split reasoning and content chunks including a final unterminated line', async (t) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of [
        'data: {"choices":[{"delta":{"reasoning_content":"思',
        '考"}}]}\r\n',
        'data: {"choices":[{"delta":{"content":"答案"}}]}',
      ]) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  mockResponse(t, new Response(stream));
  const reasoning = [];
  const content = [];
  await streamChat(config, [{ role: 'user', content: 'hi' }], new AbortController().signal, {
    onReasoning: (value) => reasoning.push(value),
    onContent: (value) => content.push(value),
  });
  assert.deepEqual(reasoning, ['思考']);
  assert.deepEqual(content, ['答案']);
});

test('non-JSON API errors retain the body and status', async (t) => {
  mockResponse(t, new Response('temporarily unavailable', { status: 503 }));
  await assert.rejects(
    streamChat(config, [{ role: 'user', content: 'hi' }], new AbortController().signal, {}),
    (error) => error instanceof KimiApiError && error.status === 503 && error.message.includes('temporarily unavailable')
  );
});
