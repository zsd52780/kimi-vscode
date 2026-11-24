"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODELS = exports.DEFAULT_MODEL = void 0;
exports.supportsReasoningEffort = supportsReasoningEffort;
exports.normalizeReasoningEffort = normalizeReasoningEffort;
exports.DEFAULT_MODEL = 'kimi-k3.1-pro';
exports.MODELS = [
    { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro', reasoningEffort: true },
    { id: 'kimi-k3.1-pro-highspeed', label: 'Kimi K3.1 Pro Highspeed', reasoningEffort: true },
    { id: 'kimi-k3', label: 'Kimi K3', reasoningEffort: true },
    { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code（将下线）', reasoningEffort: false },
    { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code Highspeed（将下线）', reasoningEffort: false },
    { id: 'kimi-k2.6', label: 'Kimi K2.6（将下线）', reasoningEffort: false },
];
function supportsReasoningEffort(model) {
    return model === 'kimi-k3[1m]' ||
        exports.MODELS.some((item) => item.id === model && item.reasoningEffort);
}
function normalizeReasoningEffort(value) {
    return value === 'low' || value === 'high' || value === 'max' ? value : 'max';
}
//# sourceMappingURL=models.js.map