export const DEFAULT_MODEL = 'kimi-k3.1-pro';

export const MODELS = [
  { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro', reasoningEffort: true },
  { id: 'kimi-k3.1-pro-highspeed', label: 'Kimi K3.1 Pro Highspeed', reasoningEffort: true },
  { id: 'kimi-k3', label: 'Kimi K3', reasoningEffort: true },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code（将下线）', reasoningEffort: false },
  { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code Highspeed（将下线）', reasoningEffort: false },
  { id: 'kimi-k2.6', label: 'Kimi K2.6（将下线）', reasoningEffort: false },
] as const;

export type ReasoningEffort = 'low' | 'high' | 'max';

export function supportsReasoningEffort(model: string): boolean {
  return model === 'kimi-k3[1m]' ||
    MODELS.some((item) => item.id === model && item.reasoningEffort);
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === 'low' || value === 'high' || value === 'max' ? value : 'max';
}
