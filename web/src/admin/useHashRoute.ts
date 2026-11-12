import { useEffect, useState } from 'react';
import { PLUGIN_TABS } from '../../../plugins/web/admin';

/**
 * The top bar, left to right. Plugin tabs sit between Media and Signs: what a
 * plugin adds is content, and Signs and Settings are the machinery around it.
 */
export const TABS: string[] = [
  'slides',
  'media',
  ...PLUGIN_TABS.map((tab) => tab.id),
  'signs',
  'settings',
];

export const TAB_LABELS: Record<string, string> = {
  slides: 'Slides',
  media: 'Media',
  signs: 'Signs',
  settings: 'Settings',
  ...Object.fromEntries(PLUGIN_TABS.map((tab) => [tab.id, tab.label])),
};

function readTab(): string {
  const raw = window.location.hash.replace(/^#\/?/, '');
  // An unknown hash — a bookmark of a tab whose plugin has since been removed —
  // lands on Slides rather than on nothing.
  return TABS.includes(raw) ? raw : 'slides';
}

/**
 * Hash routing keeps the panel a single static file — no server rewrite rules,
 * and the back button still works between tabs.
 */
export function useHashRoute(): [string, (tab: string) => void] {
  const [tab, setTab] = useState<string>(readTab);

  useEffect(() => {
    const onHashChange = () => setTab(readTab());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return [
    tab,
    (next: string) => {
      window.location.hash = `/${next}`;
      setTab(next);
    },
  ];
}
