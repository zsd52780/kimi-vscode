"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KimiApiError = void 0;
exports.streamChat = streamChat;
class KimiApiError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'KimiApiError';
    }
}
exports.KimiApiError = KimiApiError;
/**
 * 调用 Kimi 的 OpenAI 兼容 Chat Completions 接口并解析流式响应。
 * 流式响应包含两类增量：reasoning_content（思考过程）和 content（最终答案）。
 */
async function streamChat(config, messages, signal, events) {
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const body = {
        model: config.model,
        messages,
        stream: true,
        max_completion_tokens: config.maxTokens,
    };
    if (config.reasoningEffort) {
        // reasoning_effort 是 Kimi K3 的顶层参数；K2.7 Code / K2.6 系列不使用该字段
        body.reasoning_effort = config.reasoningEffort;
    }
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
    });
    if (!response.ok || !response.body) {
        let detail = '';
        try {
            const json = (await response.json());
            detail = json.error?.message ?? JSON.stringify(json);
        }
        catch {
            detail = await response.text();
        }
        throw new KimiApiError(`请求失败（HTTP ${response.status}）：${detail}`, response.status);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) {
                continue;
            }
            const data = line.slice(5).trim();
            if (data === '[DONE]') {
                return;
            }
            let chunk;
            try {
                chunk = JSON.parse(data);
            }
            catch {
                continue;
            }
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) {
                continue;
            }
            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
                events.onReasoning?.(delta.reasoning_content);
            }
            if (typeof delta.content === 'string' && delta.content.length > 0) {
                events.onContent?.(delta.content);
            }
        }
    }
}
//# sourceMappingURL=kimiClient.js.map