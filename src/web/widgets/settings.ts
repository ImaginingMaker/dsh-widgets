import React from 'react';
import { LANGUAGES, WIDGETS } from '../../shared/types.js';
import type { LanguageSetting, ModelRoute, WidgetId } from '../../shared/types.js';
import { matchesQuery, translatorFor } from '../kernel/i18n.js';
import { isOn } from '../kernel/settingsStore.js';
import type { SettingsView } from '../kernel/settingsStore.js';

const FIELD: React.CSSProperties = {
  font: 'inherit', fontSize: 12, padding: '3px 6px', borderRadius: 6,
  border: '.5px solid var(--dsw-alias-border-l2,#ccc)', background: 'transparent', color: 'inherit',
};
const LABEL: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' };
const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '14px 0',
  borderBottom: '.5px solid var(--dsw-alias-border-l2)',
};

export interface SwitchProps {
  readonly on: boolean;
  readonly onChange: (next: boolean) => void;
  readonly label: string;
  /** Carried on the element so the panel's rows can be found without rendering them. */
  readonly 'data-dsh-widgets-switch'?: string;
}

export function Switch({ on, onChange, label }: SwitchProps): React.ReactElement {
  return React.createElement('button', {
    type: 'button', role: 'switch', 'aria-checked': on, 'aria-label': label,
    'data-dsh-widgets-switch': '', onClick: () => onChange(!on),
    style: {
      position: 'relative', width: 38, height: 22, flexShrink: 0, borderRadius: 11, border: 0, cursor: 'pointer', padding: 0,
      background: on ? 'var(--dsw-alias-state-business-primary,#3b6cf6)' : 'var(--dsw-alias-interactive-bg-hover,#d5d5d9)',
    },
  }, React.createElement('span', {
    style: { position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: 8, background: '#fff' },
  }));
}

export interface WidgetSettingsProps {
  readonly store: {
    getSnapshot(): SettingsView;
    save(body: unknown): Promise<unknown>;
    load?(): Promise<unknown>;
  };
  readonly models: {
    getSnapshot(): { providers: readonly { id: string; name: string; models: readonly { id: string; name: string }[] }[] };
    subscribe(listener: () => void): () => void;
    reasoningOf(provider: string, model: string): Promise<{ supported: boolean; efforts: readonly { id: string; name: string; description?: string }[] }>;
  };
  readonly locale?: { getSnapshot(): { active?: string } };
}

const LANGUAGE_LABEL: Record<LanguageSetting, string> = {
  auto: 'settings.languageAuto',
  en: 'English',
  zh: '中文',
};

/** Settings → Widgets: one row per switch, one shared model, one language, and the target's default. */
export function WidgetSettings({ store, models, locale }: WidgetSettingsProps): React.ReactElement {
  const settings = React.useSyncExternalStore(
    (listener) => (store as unknown as { subscribe?(l: () => void): () => void }).subscribe?.(listener) ?? (() => {}),
    store.getSnapshot,
  );
  const catalogue = React.useSyncExternalStore(
    (listener) => (models as unknown as { subscribe?(l: () => void): () => void }).subscribe?.(listener) ?? (() => {}),
    models.getSnapshot,
  );

  const [query, setQuery] = React.useState('');
  const t = translatorFor(settings.language === 'en' || settings.language === 'zh'
    ? settings.language
    : (String(locale?.getSnapshot?.().active ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'));
  const analysis = settings.analysis ?? { model: null, effort: null };
  const chosen: ModelRoute | null = analysis.model ?? null;

  const [reasoning, setReasoning] = React.useState<{ supported: boolean; efforts: readonly { id: string; name: string; description?: string }[] }>({ supported: false, efforts: [] });
  const key = chosen === null ? '' : `${chosen.provider}/${chosen.model}`;
  React.useEffect(() => {
    let live = true;
    if (chosen === null) { setReasoning({ supported: false, efforts: [] }); return undefined; }
    models.reasoningOf(chosen.provider, chosen.model).then((value) => { if (live) setReasoning(value ?? { supported: false, efforts: [] }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const ids = WIDGETS.filter((id) => matchesQuery(query, t(`widget.${id}`), t(`widget.${id}.desc`), id));
  const modelValue = chosen === null ? '' : JSON.stringify([chosen.provider, chosen.model]);

  const modelMenu = React.createElement('select', {
    className: 'dw-field', 'data-dsh-widgets-analysis-model': '', value: modelValue,
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      const model = value === '' ? null : (() => {
        const [provider, id] = JSON.parse(value) as [string, string];
        return { provider, model: id };
      })();
      void store.save({ analysis: { model, effort: null } });
    },
  },
  React.createElement('option', { value: '' }, t('settings.modelChat')),
  ...catalogue.providers.map((providerModal) => React.createElement('optgroup', { key: providerModal.id, label: providerModal.name },
    ...providerModal.models.map((model) => React.createElement('option', { key: `${providerModal.id}/${model.id}`, value: JSON.stringify([providerModal.id, model.id]) }, model.name)))));

  /**
   * The effort menu only makes sense once a model is chosen: with "same as the chat" the effort belongs to whichever model
   * that chat runs, and claiming "this model declares no reasoning effort" there would be a plain lie.
   */
  const effortMenu = chosen === null
    ? React.createElement('span', { role: 'status', 'data-dsh-widgets-effort-follows': '', style: LABEL }, t('settings.thinkingFollowsChat'))
    : reasoning.supported
      ? React.createElement('select', {
        className: 'dw-field', 'data-dsh-widgets-analysis-effort': '', value: analysis.effort ?? '',
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
          void store.save({ analysis: { effort: event.target.value === '' ? null : event.target.value } });
        },
      },
      React.createElement('option', { value: '' }, t('settings.thinkingDefault')),
      ...reasoning.efforts.map((entry) => React.createElement('option', { key: entry.id, value: entry.id, title: entry.description }, entry.name)))
      : React.createElement('span', { role: 'status', 'data-dsh-widgets-effort-none': '', style: LABEL }, t('settings.thinkingNone'));

  const analysisRow = React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 } },
    React.createElement('span', { style: LABEL }, t('settings.model')), modelMenu,
    React.createElement('span', { style: LABEL }, t('settings.thinking')), effortMenu,
    React.createElement('span', { style: { ...LABEL, flexBasis: '100%' } }, t('settings.modelShared')));

  const rows = ids.map((id: WidgetId) => React.createElement('div', { key: id, style: ROW, 'data-dsh-widgets-row': id },
    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
      React.createElement('div', { style: { fontSize: 14, lineHeight: '20px' } }, t(`widget.${id}`)),
      React.createElement('div', { style: { ...LABEL, marginTop: 4, lineHeight: '18px' } }, t(`widget.${id}.desc`)),
      // The shared model is shown once, under the first widget that uses it.
      id === 'improvePrompt' && isOn(settings, id) ? analysisRow : null),
    React.createElement(Switch, {
      'data-dsh-widgets-switch': '',
      on: isOn(settings, id),
      label: t(`widget.${id}`),
      onChange: (next: boolean) => { void store.save({ id, on: next }); },
    })));

  const languageRow = React.createElement('div', { style: { ...ROW, borderBottom: 'none', paddingTop: 0 } },
    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
      React.createElement('div', { style: { fontSize: 14, lineHeight: '20px' } }, t('settings.language'))),
    React.createElement('select', {
      className: 'dw-field', 'data-dsh-widgets-language': '', value: settings.language ?? 'auto',
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
        void store.save({ language: event.target.value as LanguageSetting });
      },
    }, LANGUAGES.map((value) => React.createElement('option', { key: value, value }, t(LANGUAGE_LABEL[value])))));

  return React.createElement('div', { 'data-dsh-widgets-settings': '' },
    React.createElement('div', { style: { ...LABEL, lineHeight: '18px', paddingBottom: 6 } }, t('settings.intro')),
    settings.error === undefined ? null : React.createElement('div', { role: 'alert', className: 'dw-error', style: { paddingBottom: 6 } },
      t('settings.loadFailed', { error: settings.error })),
    languageRow,
    React.createElement('input', {
      type: 'search', className: 'dw-field', value: query,
      placeholder: t('settings.search'), 'aria-label': t('settings.search'),
      'data-dsh-widgets-search': '', onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
      style: { padding: '5px 8px', margin: '6px 0', width: '100%', boxSizing: 'border-box' },
    }),
    ids.length === 0
      ? React.createElement('div', { role: 'status', style: { fontSize: 13, padding: '20px 0', textAlign: 'center' } }, t('settings.searchEmpty'))
      : null,
    ...rows);
}