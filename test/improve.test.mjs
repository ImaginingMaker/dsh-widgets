// Improve prompt: the prompt it builds, the file reads behind it, and the route — including that a newer ask replaces the
// older call instead of locking the composer, and that the effort reaches the model call only when the model has one.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IMPROVE_INPUT_MAX, IMPROVE_PATH, IMPROVE_MAX_TOKENS, callControls, improveInputOk, improvePromptText,
  installImprove, projectBrief, readInside,
} from '../dist/index.js';
import { call, makeCtx, makeLlm, tempDir } from './helpers.mjs';


// ---- the request bounds ------------------------------------------------------------------------------------------------
assert.equal(improveInputOk('fix the login'), true);
assert.equal(improveInputOk('a'.repeat(IMPROVE_INPUT_MAX)), true);
assert.equal(improveInputOk('a'.repeat(IMPROVE_INPUT_MAX + 1)), false);
assert.equal(improveInputOk('   '), false);
assert.equal(improveInputOk(''), false);
assert.equal(improveInputOk(undefined), false);
assert.equal(improveInputOk(42), false);

// ---- the prompt --------------------------------------------------------------------------------------------------------
const prompt = improvePromptText('make login work', '<README.md>\n# app\n</README.md>');
assert.match(prompt, /<draft>\nmake login work\n<\/draft>/);
assert.match(prompt, /<project>\n<README\.md>\n# app\n<\/README\.md>\n<\/project>/);
assert.match(prompt, /State the goal first/);
assert.match(prompt, /Return only the rewritten prompt/, 'the model is told not to wrap its answer');
const withoutProject = improvePromptText('x', '');
assert.equal(withoutProject.includes('<project>'), false, 'no project block without a brief');
assert.match(withoutProject, /<draft>\nx\n<\/draft>/);

// ---- safe reads --------------------------------------------------------------------------------------------------------
const { dir, cleanup } = tempDir();
try {
  mkdirSync(join(dir, 'project'), { recursive: true });
  // macOS resolves /var through /private/var, and the containment check compares real paths.
  const project = realpathSync(join(dir, 'project'));
  writeFileSync(join(project, 'README.md'), '# app\nsecond line\n');
  assert.equal(readInside(project, 'README.md'), '# app\nsecond line\n');
  assert.equal(readInside(project, 'README.md', 5), '# app');
  assert.equal(readInside(project, 'missing.md'), undefined);

  // A symlink that leaves the folder is refused, so a swapped-in link cannot read another file.
  const secret = join(dir, 'secret.txt');
  writeFileSync(secret, 'do not read');
  symlinkSync(secret, join(project, 'AGENTS.md'));
  assert.equal(readInside(project, 'AGENTS.md'), undefined, 'a symlink out of the folder is refused');

  // A FIFO is not a regular file: it is refused without blocking the caller.
  const fifo = join(dir, 'pipe');
  execFileSync('mkfifo', [fifo]);
  symlinkSync(fifo, join(project, 'package.json'));
  assert.equal(readInside(project, 'package.json'), undefined);

  // The brief is the three files it knows, and only the readable ones.
  rmSync(join(project, 'AGENTS.md'));
  rmSync(join(project, 'package.json'));
  writeFileSync(join(project, 'AGENTS.md'), 'rules\n');
  assert.equal(projectBrief(project), '<AGENTS.md>\nrules\n</AGENTS.md>\n\n<README.md>\n# app\nsecond line\n</README.md>');
  assert.equal(projectBrief(join(dir, 'nowhere')), '');
} finally { cleanup(); }

// ---- the route ---------------------------------------------------------------------------------------------------------
const TABLE = {
  'local': {
    models: [
      { id: 'with-effort', name: 'With effort', reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }], defaultEffort: 'low' } },
      { id: 'no-effort', name: 'No effort' },
    ],
  },
};

// A successful call: the model gets the draft, and the answer is the draft's replacement.
{
  const home = tempDir();
  const llm = makeLlm(TABLE, { preparers: () => 'Make the login form work end to end.' });
  const { ctx, routes } = makeCtx({ services: { llm } });
  installImprove({ ...ctx }, home.dir);

  const ok = await call(routes, IMPROVE_PATH, { method: 'POST', body: { sessionId: 's1', text: 'make login work', provider: 'local', model: 'no-effort' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.text, 'Make the login form work end to end.');
  assert.equal(ok.json.effort, null, 'a model without efforts sends no effort');
  assert.equal(llm.calls.length, 1);
  assert.equal('reasoningEffort' in llm.calls[0], false);

  // With a model that declares efforts, the chosen effort reaches the call; "off" does not.
  const high = await call(routes, IMPROVE_PATH, { method: 'POST', body: { sessionId: 's2', text: 'x', provider: 'local', model: 'with-effort', effort: 'high' } });
  assert.equal(high.status, 200);
  assert.equal(high.json.effort, 'high');
  assert.equal(llm.calls.at(-1).reasoningEffort, 'high');

  const off = await call(routes, IMPROVE_PATH, { method: 'POST', body: { sessionId: 's3', text: 'x', provider: 'local', model: 'with-effort', effort: 'off' } });
  assert.equal(off.status, 200);
  assert.equal(off.json.effort, null);
  assert.equal('reasoningEffort' in llm.calls.at(-1), false, 'off sends nothing');

  // A saved effort is used when the request does not name one.
  const settingsFile = join(home.dir, 'storages', 'dsh-widgets', 'settings.json');
  mkdirSync(join(home.dir, 'storages', 'dsh-widgets'), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({ improve: { effort: 'low' } }));
  const saved = await call(routes, IMPROVE_PATH, { method: 'POST', body: { sessionId: 's4', text: 'x', provider: 'local', model: 'with-effort' } });
  assert.equal(saved.json.effort, 'low');

  // Bad input is refused before any model call.
  const before = llm.calls.length;
  for (const body of [
    {}, { sessionId: 's', text: 'x' }, { sessionId: 's', text: '', provider: 'local', model: 'no-effort' },
    { sessionId: 's', text: 'x'.repeat(IMPROVE_INPUT_MAX + 1), provider: 'local', model: 'no-effort' },
    { sessionId: 's', text: 'x', provider: '', model: 'no-effort' },
    'nope',
  ]) {
    assert.equal((await call(routes, IMPROVE_PATH, { method: 'POST', body })).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(llm.calls.length, before, 'no model call for a refused request');

  // An unknown route is a failure from the model service, reported, not a crash.
  const unknown = await call(routes, IMPROVE_PATH, { method: 'POST', body: { sessionId: 's', text: 'x', provider: 'local', model: 'nope' } });
  assert.equal(unknown.status, 502);
  assert.match(unknown.json.error, /unknown model/);
  home.cleanup();
}

// A profile with no model service: the panel says so instead of failing silently.
{
  const home = tempDir();
  const { ctx, routes } = makeCtx({ services: {} });
  installImprove({ ...ctx }, home.dir);
  const answer = await call(routes, IMPROVE_PATH, { method: 'POST', body: { sessionId: 's', text: 'x', provider: 'p', model: 'm' } });
  assert.equal(answer.status, 409);
  assert.match(answer.json.error, /cannot call a model/);
  home.cleanup();
}

// One call per chat: a newer ask aborts the older one, which answers 409 instead of holding the composer.
{
  const home = tempDir();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const llm = {
    listProviders: () => [{ id: 'local', name: 'local' }],
    listModels: async () => [],
    resolveModelInfo: async () => ({}),
    prepareCall: async (config) => ({
      config,
      stream: (options) => (async function* generate() {
        await Promise.race([
          gate,
          new Promise((_, reject) => {
            if (options.signal.aborted) reject(new Error('aborted'));
            options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
        ]);
        yield { type: 'text-delta', index: 0, text: 'done' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })(),
    }),
  };
  const { ctx, routes } = makeCtx({ services: { llm } });
  installImprove({ ...ctx }, home.dir);
  const first = call(routes, IMPROVE_PATH, { method: 'POST', body: { sessionId: 'same', text: 'first', provider: 'local', model: 'm' } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = call(routes, IMPROVE_PATH, { method: 'POST', body: { sessionId: 'same', text: 'second', provider: 'local', model: 'm' } });
  const firstAnswer = await first;
  assert.equal(firstAnswer.status, 409);
  assert.match(firstAnswer.json.error, /newer improvement/);
  release();
  const secondAnswer = await second;
  assert.equal(secondAnswer.status, 200);
  assert.equal(secondAnswer.json.text, 'done');
  home.cleanup();
}

// A model answer with no text is a failure, not an empty replacement of the user's draft.
{
  const home = tempDir();
  const llm = makeLlm(TABLE, { preparers: () => '   ' });
  const { ctx, routes } = makeCtx({ services: { llm } });
  installImprove({ ...ctx }, home.dir);
  const answer = await call(routes, IMPROVE_PATH, { method: 'POST', body: { sessionId: 's', text: 'x', provider: 'local', model: 'no-effort' } });
  assert.equal(answer.status, 502);
  assert.match(answer.json.error, /no text/);
  home.cleanup();
}

// The draft reaches the model, not just the project description.
{
  const home = tempDir();
  const seen = [];
  const llm = makeLlm(TABLE, { preparers: () => 'ok' });
  const original = llm.prepareCall;
  llm.prepareCall = async (config) => {
    const prepared = await original(config);
    return {
      ...prepared,
      stream(options) {
        seen.push(options.messages[0].content[0].text);
        return prepared.stream(options);
      },
    };
  };
  const { ctx, routes } = makeCtx({ services: { llm } });
  installImprove({ ...ctx }, home.dir);
  await call(routes, IMPROVE_PATH, { method: 'POST', body: { sessionId: 's', text: 'the exact draft', provider: 'local', model: 'no-effort' } });
  assert.match(seen[0], /the exact draft/);
  assert.equal(llm.calls.at(-1).maxTokens === undefined, true, 'the cap travels in the stream options');
  home.cleanup();
}

void IMPROVE_MAX_TOKENS; void callControls;
console.log('improve checks passed');