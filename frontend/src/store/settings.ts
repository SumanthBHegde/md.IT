import { db } from './db';

export const SETTINGS = {
  mode: 'ui.mode',
  theme: 'ui.theme',
  storageWarningDismissed: 'ui.storageWarningDismissed',
  panel: 'ui.panel',
  panelTab: 'ui.panelTab',
  tree: 'ui.tree',
  treeWidth: 'ui.treeWidth',
  rendering: 'doc.rendering',
} as const;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value });
}
