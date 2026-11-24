const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DEFAULT_MODEL, MODELS, supportsReasoningEffort, normalizeReasoningEffort } = require('../dist/models.js');
const manifest = require('../package.json');

test('manifest model choices and default stay aligned with the model catalogue', () => {
  const setting = manifest.contributes.configuration.properties['kimiK3.model'];
  assert.equal(setting.default, DEFAULT_MODEL);
  assert.deepEqual([...setting.enum].sort(), MODELS.map((model) => model.id).sort());
});

test('only supported K3 models accept reasoning effort', () => {
  for (const model of MODELS) {
    assert.equal(supportsReasoningEffort(model.id), model.reasoningEffort, model.id);
  }
  assert.equal(supportsReasoningEffort('kimi-k3[1m]'), true);
  assert.equal(supportsReasoningEffort('kimi-unknown'), false);
});

test('invalid reasoning effort falls back to the documented max default', () => {
  for (const value of ['low', 'high', 'max']) {
    assert.equal(normalizeReasoningEffort(value), value);
  }
  for (const value of [undefined, null, '', 'medium', 'HIGH', 1]) {
    assert.equal(normalizeReasoningEffort(value), 'max');
  }
});
