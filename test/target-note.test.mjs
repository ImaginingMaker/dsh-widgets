// The note a chat opens with: what the agent is told about where it runs, and the chip label that must agree with it.
import assert from 'node:assert/strict';
import { targetLabel, targetNote } from '../dist/index.js';

// The default target adds nothing at all: a chat started on the current branch must be exactly the chat dsh would run.
assert.equal(targetNote({ mode: 'current', base: 'main' }), '');
assert.equal(targetNote({ mode: 'current' }, 'zh'), '');

// A new branch: the agent is told which branch, off which base, and what to do when it cannot.
const branch = targetNote({ mode: 'branch', base: 'main', branchName: 'feat/login' });
assert.match(branch, /feat\/login/);
assert.match(branch, /main/);
assert.match(branch, /Do not switch to another branch/, 'the agent is told not to wander off the branch');
assert.match(targetNote({ mode: 'branch', base: 'main', branchName: 'feat/login' }, 'zh'), /分支/);
assert.equal(targetNote({ mode: 'branch' }), '', 'a branch note without a name or base is not written');

// A worktree reads differently depending on whether the chat itself moved into it.
const moved = targetNote({ mode: 'worktree', branchName: 'feat/x', worktreePath: '/p/.worktrees/feat-x', moved: true });
assert.match(moved, /\/p\/\.worktrees\/feat-x/);
assert.match(moved, /works in the new worktree/);
assert.equal(/absolute path/.test(moved), false, 'a chat that moved needs no absolute-path rule');
const elsewhere = targetNote({ mode: 'worktree', branchName: 'feat/x', worktreePath: '/p/.worktrees/feat-x' });
assert.match(elsewhere, /absolute path/, 'a chat that did not move is told to use absolute paths');
assert.match(targetNote({ mode: 'worktree', branchName: 'feat/x', worktreePath: '/w', moved: true }, 'zh'), /worktree/);

// The two reuse targets.
assert.match(targetNote({ mode: 'existing-branch', existingBranch: 'release/2' }), /release\/2/);
assert.match(targetNote({ mode: 'existing-worktree', worktreePath: '/p/.worktrees/a', existingBranch: 'feat/a' }), /feat\/a/);
assert.match(targetNote({ mode: 'existing-worktree', worktreePath: '/p/.worktrees/a', existingBranch: 'feat/a' }, 'zh'), /绝对路径/);
assert.equal(targetNote({ mode: 'existing-worktree' }), '', 'nothing to say without a folder');

// The chip's label comes from the same shape, so the chip and the note cannot disagree.
assert.equal(targetLabel({ mode: 'current', base: 'main' }), 'main');
assert.equal(targetLabel({ mode: 'current' }, 'zh'), '当前分支');
assert.equal(targetLabel({ mode: 'branch', branchName: 'feat/x' }), 'feat/x');
assert.equal(targetLabel({ mode: 'existing-branch', existingBranch: 'release/2' }), 'release/2');
assert.equal(targetLabel({ mode: 'existing-worktree', worktreePath: '/p/.worktrees/a' }), '/p/.worktrees/a');
assert.equal(targetLabel({ mode: 'worktree' }, 'zh'), '新建 worktree');

console.log('target-note checks passed');