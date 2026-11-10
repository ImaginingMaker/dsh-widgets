// The model route: the configuration's providers/models, per-model reasoning, and the service's failure fallbacks.
import assert from 'node:assert/strict';
import { MODELS_PATH, installModels } from '../dist/index.js';
import { call, makeCtx } from './helpers.mjs';

const llm = {
  listProviders: () => [
    { id: 'p1', name: 'Provider one' },
    { id: 'p2' },
  ],
  listModels: async (provider) => (provider === 'p1'
    ? [
      { id: 'm1', name: 'Model one', inputModalities: ['text', 'image'] },
      { id: '', name: 'no id' },
      { id: 'm2' },
      null,
    ]
    : (() => { throw new Error('list failed'); })()),
  resolveModelInfo: async (provider, model) => {
    if (model === 'boom') throw new Error('adapter gone');
    return { reasoning: { efforts: [{ id: 'off' }, { id: 'high', name: 'High' }], defaultEffort: 'off' } };
  },
};

{
  const { ctx, routes } = makeCtx({ services: { llm } });
  installModels(ctx);
  const answer = await call(routes, MODELS_PATH);
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.json.providers.map((provider) => provider.id), ['p1', 'p2']);
  assert.equal(answer.json.providers[0].name, 'Provider one');
  assert.equal(answer.json.providers[1].name, 'p2');
  assert.deepEqual(answer.json.providers[0].models.map((model) => model.id), ['m1', 'm2'], 'empty ids are dropped');
  assert.equal(answer.json.providers[0].models[0].name, 'Model one');
  assert.deepEqual(answer.json.providers[0].models[0].inputModalities, ['text', 'image']);
  assert.equal(answer.json.providers[0].models[1].name, 'm2', 'a nameless model falls back to its id');
  assert.deepEqual(answer.json.providers[1].models, [], 'a broken provider lists no models and keeps the panel usable');
}

{
  const { ctx, routes } = makeCtx({ services: { llm } });
  installModels(ctx);
  const answer = await call(routes, MODELS_PATH, { search: { provider: 'p1', model: 'm1' } });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.json.provider, 'p1');
  assert.equal(answer.json.model, 'm1');
  assert.deepEqual(answer.json.reasoning.efforts.map((entry) => entry.id), ['off', 'high']);
  assert.equal(answer.json.reasoning.defaultEffort, 'off');

  const gone = await call(routes, MODELS_PATH, { search: { provider: 'p1', model: 'boom' } });
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.json.reasoning, { supported: false, efforts: [] });
  assert.match(gone.json.error, /adapter gone/);

  // A partial query is still a list query.
  const partial = await call(routes, MODELS_PATH, { search: { provider: 'p1' } });
  assert.equal(partial.status, 200);
  assert.ok(Array.isArray(partial.json.providers));
}

{
  const { ctx, routes } = makeCtx({ services: {} });
  installModels(ctx);
  const answer = await call(routes, MODELS_PATH);
  assert.equal(answer.status, 409);
  assert.match(answer.json.error, /no model service/);
}

console.log('models route checks passed');