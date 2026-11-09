// Reasoning efforts come from this Mac's model configuration, never from a fixed ladder. The fixtures below are the
// exact shape the local configuration declares (`off: null`, `low`, `medium`, `high`), as `resolveModelInfo` reports it.
import assert from 'node:assert/strict';
import { OFF_EFFORT, callControls, reasoningOptions } from '../dist/index.js';

/** What the local config `off: null / low: low / medium: medium / high: high` turns into. */
const FOUR_LEVELS = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'low', name: 'Low', description: 'Fewer tokens spent thinking' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
  ],
  defaultEffort: 'medium',
};

// The list is the configuration's own list, in its order, with names and descriptions kept.
const options = reasoningOptions({ reasoning: FOUR_LEVELS });
assert.equal(options.supported, true);
assert.deepEqual(options.efforts.map((entry) => entry.id), ['off', 'low', 'medium', 'high']);
assert.equal(options.efforts[1].name, 'Low');
assert.equal(options.efforts[1].description, 'Fewer tokens spent thinking');
assert.equal(options.defaultEffort, 'medium');
assert.equal(OFF_EFFORT, 'off');

// A model the configuration declares without efforts has none: no ladder is invented for it.
for (const modelInfo of [
  {},
  { reasoning: undefined },
  { reasoning: {} },
  { reasoning: { efforts: [] } },
  { reasoning: { efforts: 'low' } },
  null,
  undefined,
  'text',
]) {
  const none = reasoningOptions(modelInfo);
  assert.equal(none.supported, false, JSON.stringify(modelInfo));
  assert.deepEqual(none.efforts, []);
  assert.equal(none.defaultEffort, undefined);
  assert.deepEqual(callControls('low', modelInfo), {}, 'nothing is sent for a model with no efforts');
}

// Entries are narrowed: a nameless effort falls back to its id, a duplicated id appears once, junk is dropped.
const narrowed = reasoningOptions({
  reasoning: {
    efforts: [
      { id: 'low', name: '' },
      { id: 'low', name: 'again' },
      { id: '' },
      { name: 'no id' },
      null,
      { id: 'high', name: 'High', description: 42 },
    ],
    defaultEffort: 7,
  },
});
assert.deepEqual(narrowed.efforts.map((entry) => entry.id), ['low', 'high']);
assert.equal(narrowed.efforts[0].name, 'low', 'a nameless effort is named by its id');
assert.equal('description' in narrowed.efforts[1], false, 'a wrong type is dropped');
assert.equal(narrowed.defaultEffort, undefined);

// What is actually sent: the chosen effort, the model default when nothing is chosen, and nothing for "off".
assert.deepEqual(callControls('low', { reasoning: FOUR_LEVELS }), { reasoningEffort: 'low' });
assert.deepEqual(callControls('high', { reasoning: FOUR_LEVELS }), { reasoningEffort: 'high' });
assert.deepEqual(callControls(undefined, { reasoning: FOUR_LEVELS }), { reasoningEffort: 'medium' }, 'the model default');
assert.deepEqual(callControls(null, { reasoning: FOUR_LEVELS }), { reasoningEffort: 'medium' });
assert.deepEqual(callControls('', { reasoning: FOUR_LEVELS }), { reasoningEffort: 'medium' });
assert.deepEqual(callControls('off', { reasoning: FOUR_LEVELS }), {}, 'off means the field is not sent at all');
assert.deepEqual(callControls('medium', { reasoning: FOUR_LEVELS }), { reasoningEffort: 'medium' });

// An effort the model does not declare falls back to the model's own default rather than being clamped or guessed:
// dsh rejects an unsupported explicit effort before any provider I/O.
assert.deepEqual(callControls('ultra', { reasoning: FOUR_LEVELS }), { reasoningEffort: 'medium' });
assert.deepEqual(callControls('LOW', { reasoning: FOUR_LEVELS }), { reasoningEffort: 'medium' }, 'ids are exact');
assert.deepEqual(callControls('x'.repeat(80), { reasoning: FOUR_LEVELS }), { reasoningEffort: 'medium' });
assert.deepEqual(callControls(42, { reasoning: FOUR_LEVELS }), { reasoningEffort: 'medium' });

// A default of "off" is honoured as "send nothing", not as a missing default.
assert.deepEqual(callControls(undefined, { reasoning: { efforts: [{ id: 'off' }, { id: 'high' }], defaultEffort: 'off' } }), {});
assert.deepEqual(callControls(undefined, { reasoning: { efforts: [{ id: 'high' }], defaultEffort: 'off' } }), {}, 'an undeclared default is not sent');

// A model whose configuration declares only one level still offers exactly that one.
const single = { reasoning: { efforts: [{ id: 'high', name: 'High' }] } };
assert.deepEqual(reasoningOptions(single).efforts.map((entry) => entry.id), ['high']);
assert.deepEqual(callControls(undefined, single), {}, 'no declared default: nothing is invented');
assert.deepEqual(callControls(undefined, { reasoning: { efforts: [{ id: 'high' }], defaultEffort: 'high' } }), { reasoningEffort: 'high' });
assert.deepEqual(callControls('off', single), {}, 'a model with no off level sends nothing and keeps its own behaviour');

console.log('reasoning checks passed');