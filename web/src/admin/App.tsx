import { useCallback, useState } from 'react';
import { PLUGIN_TABS } from '../../../plugins/web/admin';
import { MediaPage } from './pages/MediaPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignsPage } from './pages/SignsPage';
import { SlidesPage } from './pages/SlidesPage';
import { SignPreviewDialog } from './SignPreviewDialog';
import { TAB_LABELS, TABS, useHashRoute } from './useHashRoute';

export function App() {
  const [tab, setTab] = useHashRoute();
  const [previewing, setPreviewing] = useState(false);

  // Which playlist the Slides tab is on, so previewing from any tab shows the
  // one being worked on rather than always the one on air. Held up here
  // because the top bar outlives the page that knows it.
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const onPlaylistChange = useCallback((id: string | null) => setPlaylistId(id), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark" aria-hidden="true" />
          Sign control panel
        </div>
        <nav className="topbar__nav">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              className={`topbar__tab ${tab === name ? 'is-active' : ''}`}
              onClick={() => setTab(name)}
            >
              {TAB_LABELS[name]}
            </button>
          ))}
        </nav>
        {/* Stays on the page: checking the sign is something you do between
            edits, and losing the panel to a new tab every time made it a
            bigger decision than it should be. The new tab is still one click
            away inside. */}
        <button type="button" className="topbar__preview" onClick={() => setPreviewing(true)}>
          Preview sign
        </button>
      </header>

      <main className="main">
        {tab === 'slides' ? <SlidesPage onPlaylistChange={onPlaylistChange} /> : null}
        {tab === 'signs' ? <SignsPage /> : null}
        {tab === 'media' ? <MediaPage /> : null}
        {tab === 'settings' ? <SettingsPage /> : null}
        {PLUGIN_TABS.map(({ id, page: Page }) => (tab === id ? <Page key={id} /> : null))}
      </main>

      <SignPreviewDialog
        open={previewing}
        playlistId={playlistId}
        onClose={() => setPreviewing(false)}
      />
    </div>
  );
}
