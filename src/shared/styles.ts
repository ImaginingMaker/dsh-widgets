/**
 * The stylesheet the widgets share.
 *
 * It is injected once, when the plugin mounts, rather than by whichever component happens to render first: a button class
 * that only exists while one particular panel is drawn leaves every other control unstyled, which is exactly what a bare
 * browser border around a composer button looks like.
 */
export const WIDGETS_CSS = `
.dw-btn {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  line-height: 1;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: var(--dsw-radius-sm, 6px);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  opacity: .85;
  transition: background-color .12s ease, opacity .12s ease;
}
.dw-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); opacity: 1; }
.dw-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #3b6cf6); outline-offset: 1px; }
.dw-btn:disabled { opacity: .4; cursor: default; }
.dw-btn[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); opacity: 1; }

.dw-panel {
  position: absolute;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 260px;
  padding: 12px;
  border-radius: var(--dsw-radius-md, 8px);
  border: .5px solid var(--dsw-alias-border-l2, #ccc);
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, inherit);
  box-shadow: var(--dsw-elevation-soft, 0 4px 16px rgba(0,0,0,.16));
}
.dw-field {
  font: inherit;
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 6px;
  border: .5px solid var(--dsw-alias-border-l2, #ccc);
  background: transparent;
  color: inherit;
}
.dw-error { font-size: 12px; color: var(--dsw-alias-state-warn-label, #b25000); }

/* A panel action. Unlike .dw-btn, this one has to look pressable: a bordered row across the panel's foot. */
.dw-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  align-self: stretch;
  margin-top: 4px;
  padding: 5px 10px;
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-primary, inherit);
  background: transparent;
  border: .5px solid var(--dsw-alias-border-l2, #ccc);
  border-radius: var(--dsw-radius-sm, 6px);
  cursor: pointer;
  transition: background-color .12s ease, border-color .12s ease;
}
.dw-action:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dw-action:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #3b6cf6); outline-offset: 1px; }
.dw-action:active { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.18)); }
.dw-action svg { flex: none; }

/* While one optimisation runs, the wand pulses and the composer it is reading is visibly closed for business. The
   attribute is this plugin's own and is removed when the call settles. */
.dw-btn[data-dsh-widgets-working] { opacity: 1; }
.dw-btn[data-dsh-widgets-working] svg { animation: dw-pulse 1.1s ease-in-out infinite; }
.dw-btn[data-dsh-widgets-handoff-working] { opacity: 1; }
.dw-btn[data-dsh-widgets-handoff-working] svg { animation: dw-pulse 1.1s ease-in-out infinite; }

/* A handoff that already happened, remembered across session switches: one short pressable sentence plus a way to
   forget it. It is a pill rather than a panel action because it lives in the composer row beside the icons. */
.dw-handoff-done {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-primary, inherit);
  background: transparent;
  border: .5px solid var(--dsw-alias-border-l2, #ccc);
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
}
.dw-handoff-done:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dw-handoff-done:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #3b6cf6); outline-offset: 1px; }
.dw-handoff-dismiss { padding: 2px 4px; font-size: 12px; line-height: 16px; opacity: .65; }
.dw-handoff-dismiss:hover { opacity: 1; }
@keyframes dw-pulse {
  0%, 100% { opacity: .35; transform: scale(.9); }
  50% { opacity: 1; transform: scale(1); }
}
[data-composer-seat][data-dsh-widgets-busy] [data-composer-input] {
  opacity: .5;
  pointer-events: none;
  cursor: progress;
}

.dw-panel-head {
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, inherit);
  padding-bottom: 2px;
}
.dw-panel-body {
  font-size: 12px;
  line-height: 18px;
  white-space: pre-wrap;
  overflow: auto;
  max-height: 40vh;
}

.dw-brief { display: inline-flex; align-items: center; gap: 2px; }
.dw-brief-dot { display: inline-block; width: 6px; height: 6px; border-radius: 3px; background: currentColor; }
.dw-brief-spin { animation: dw-spin 1s linear infinite; }
@keyframes dw-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .dw-brief-spin { animation: none; }
  .dw-btn { transition: none; }
  .dw-btn[data-dsh-widgets-working] svg { animation: none; opacity: 1; }
  .dw-btn[data-dsh-widgets-handoff-working] svg { animation: none; opacity: 1; }
}
`;

/** Marks the installed stylesheet, so a second mount can find it instead of adding another. */
export const STYLE_ATTR = 'data-dsh-widgets-style';

export interface StyleHost {
  head: { appendChild(node: unknown): void };
  createElement(tag: string): { setAttribute(name: string, value: string): void; textContent: string };
  querySelector(selector: string): unknown;
}

/**
 * Install the shared stylesheet once. Answers a disposer that removes it only when it is still ours, so two widgets
 * mounting and unmounting in any order cannot leave the page unstyled or strip a stylesheet the other one still needs.
 */
export function ensureStyles(doc: StyleHost | undefined): () => void {
  if (doc === undefined) return () => {};
  if (doc.querySelector(`style[${STYLE_ATTR}]`) !== null) return () => {};
  const style = doc.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  style.textContent = WIDGETS_CSS;
  doc.head.appendChild(style);
  return () => {
    const node = doc.querySelector(`style[${STYLE_ATTR}]`) as { remove?(): void } | null;
    node?.remove?.();
  };
}