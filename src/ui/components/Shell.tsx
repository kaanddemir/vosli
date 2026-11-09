import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n/strings';
import { applyUpdate, onUpdateReady } from '../../pwa';
import { hrefFor, type Place, type Route } from '../router';
import { applySidebarCollapsed, loadSidebarCollapsed, saveSidebarCollapsed } from '../sidebar';
import { Icon, type IconName } from './Icon';
import { PronunciationStatus } from './SpeakerButton';

const SECTIONS: readonly { section: 'home' | 'dictionary' | 'collections'; icon: IconName; label: string }[] = [
  { section: 'home', icon: 'today', label: t.nav.home },
  { section: 'dictionary', icon: 'dictionary', label: t.nav.dictionary },
  { section: 'collections', icon: 'collections', label: t.nav.collections },
];

/** Which main section a screen belongs to. Settings is reached from Home on phones. */
function sectionOf(place: Place): string {
  switch (place.route) {
    case 'word':
    case 'wordEdit':
    case 'wordNew':
      return place.groupId ? 'collections' : 'dictionary';
    case 'group':
    case 'import':
      return 'collections';
    default:
      return place.route;
  }
}

export function Shell({ place, children }: { place: Place; children: ComponentChildren }) {
  const main = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const [updateReady, setUpdateReady] = useState(false);
  const [collapsed, setCollapsed] = useState(loadSidebarCollapsed);
  const toggleLabel = collapsed ? t.expandMenu : t.collapseMenu;
  const section = sectionOf(place);
  const focused = place.route === 'practice' || place.route === 'review';
  const currentFor = (name: string, route: Route) => (place.route === route ? 'page' : section === name ? 'true' : undefined);

  useLayoutEffect(() => applySidebarCollapsed(collapsed), [collapsed]);

  useEffect(() => onUpdateReady(() => setUpdateReady(true)), []);

  useEffect(() => {
    // Move focus on navigation so keyboard and screen reader users land on the new screen.
    if (firstRender.current) firstRender.current = false;
    else main.current?.focus();
    scrollTo(0, 0);
  }, [place.route, place.wordId, place.groupId]);

  return (
    <div class={focused ? 'app app-focused' : 'app'}>
      {/* First, so the hidden region never adds to the page's length. */}
      <PronunciationStatus />
      <a class="skip-link" href="#main" onClick={(event) => { event.preventDefault(); main.current?.focus(); }}>
        {t.skipToContent}
      </a>
      {/* A study session has no menu: the only way out is its close button. */}
      {!focused && (
        <nav class="app-nav" aria-label={t.mainNav}>
          <div class="brand-row">
            <a class="brand" href={hrefFor('home')} title={collapsed ? t.appName : undefined}>
              <img class="brand-mark" src="./icons/vosli-mark.svg" alt="" />
              <span class="nav-label">{t.appName}</span>
            </a>
            <button
              type="button"
              class="icon-btn sidebar-toggle"
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={() => {
                saveSidebarCollapsed(!collapsed);
                setCollapsed(!collapsed);
              }}
            >
              <Icon name="sidebar" />
            </button>
          </div>
          <ul class="nav-list">
            {SECTIONS.map((item) => (
              <li key={item.section}>
                <a class="nav-link" href={hrefFor(item.section)} aria-current={currentFor(item.section, item.section)} title={collapsed ? item.label : undefined}>
                  <Icon name={item.icon} />
                  <span class="nav-label">{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
          <ul class="nav-list nav-secondary">
            <li>
              <a class="nav-link" href={hrefFor('settings')} aria-current={currentFor('settings', 'settings')} title={collapsed ? t.nav.settings : undefined}>
                <Icon name="settings" />
                <span class="nav-label">{t.nav.settings}</span>
              </a>
            </li>
          </ul>
        </nav>
      )}
      <main id="main" class="app-main" ref={main} tabIndex={-1}>
        {updateReady && (
          <div class="notice" role="status">
            <span>{t.update.ready}</span>
            <button type="button" class="btn btn-small" onClick={applyUpdate}>{t.update.apply}</button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
