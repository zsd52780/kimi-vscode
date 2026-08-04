export interface ImageUrlPart {
  type: 'image_url';
  image_url: { url: string };
}

export interface TextPart {
  type: 'text';
  text: string;
}

export type MessageContentPart = TextPart | ImageUrlPart;
export type MessageContent = string | MessageContentPart[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  reasoning?: string;
}

export interface ChatConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: 'low' | 'high' | 'max';
  maxTokens: number;
}

export interface StreamEvents {
  onReasoning?: (text: string) => void;
  onContent?: (text: string) => void;
}

export class KimiApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'KimiApiError';
  }
}

/**
 * 调用 Kimi 的 OpenAI 兼容 Chat Completions 接口并解析流式响应。
 * 流式响应包含两类增量：reasoning_content（思考过程）和 content（最终答案）。
 */
export async function streamChat(
  config: ChatConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
  events: StreamEvents
): Promise<void> {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const body: Record<string, unknown> = {
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
      const json = (await response.json()) as { error?: { message?: string } };
      detail = json.error?.message ?? JSON.stringify(json);
    } catch {
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
      let chunk: {
        choices?: Array<{
          delta?: { reasoning_content?: string; content?: string };
        }>;
      };
      try {
        chunk = JSON.parse(data) as typeof chunk;
      } catch {
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
