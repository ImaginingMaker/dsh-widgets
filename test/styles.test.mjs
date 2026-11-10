// The shared stylesheet: installed once for the whole plugin, removed with it, and carrying the classes the widgets use.
import assert from 'node:assert/strict';
import { WIDGETS_CSS, STYLE_ATTR, ensureStyles } from '../dist/index.js';

/** A fake <head> that answers the one selector `ensureStyles` asks about. */
function fakeDocument() {
  const children = [];
  return {
    children,
    createElement() {
      return { attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, textContent: '' };
    },
    head: {
      appendChild(node) {
        children.push(node);
        node.remove = () => { const index = children.indexOf(node); if (index !== -1) children.splice(index, 1); };
      },
    },
    querySelector(selector) {
      if (selector !== `style[${STYLE_ATTR}]`) return null;
      return children.find((node) => node.attrs[STYLE_ATTR] !== undefined) ?? null;
    },
  };
}

// One stylesheet for every widget, whatever renders first.
{
  const doc = fakeDocument();
  const drop = ensureStyles(doc);
  assert.equal(doc.children.length, 1);
  assert.equal(doc.children[0].textContent, WIDGETS_CSS);

  // A second widget mounting finds the stylesheet instead of adding another.
  const dropAgain = ensureStyles(doc);
  assert.equal(doc.children.length, 1, 'the stylesheet is not installed twice');
  dropAgain();
  assert.equal(doc.children.length, 1, 'a second disposer does not remove the first one\'s stylesheet');

  drop();
  assert.equal(doc.children.length, 0, 'the last disposer removes it');
}

// No document at all (a test environment, a worker) is not an error.
assert.equal(typeof ensureStyles(undefined), 'function');
ensureStyles(undefined)();

// The classes the widgets rely on live here, not in whichever component happens to render.
for (const selector of ['.dw-btn', '.dw-action', '.dw-panel', '.dw-field', '.dw-brief']) {
  assert.ok(WIDGETS_CSS.includes(selector), `${selector} is defined once`);
}
assert.match(WIDGETS_CSS, /\.dw-btn\s*\{[^}]*border:\s*0/, 'a composer button has no border of its own');
assert.match(WIDGETS_CSS, /prefers-reduced-motion/, 'the spinner respects a reduced-motion preference');
assert.equal(WIDGETS_CSS.includes('node:'), false);

console.log('styles checks passed');