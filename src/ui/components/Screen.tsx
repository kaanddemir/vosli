import type { ComponentChildren } from 'preact';
import { t } from '../../i18n/strings';
import { Icon } from './Icon';

interface ScreenProps {
  /** Text, or a German word whose article is drawn on its own. */
  title: ComponentChildren | null;
  /** The small line above the title: a date, or a count. */
  eyebrow?: string | undefined;
  /** Keeps a long eyebrow, such as a file name, to one line. The full text stays available. */
  eyebrowClip?: boolean;
  /** The parent screen. Omit on top-level screens. */
  back?: { href: string; label: string; compactOnly?: boolean } | undefined;
  actions?: ComponentChildren;
  /** Marks the title as German, for pronunciation and hyphenation. */
  titleLang?: string | undefined;
  /** A stage fills the window and holds one centered composition. */
  width?: 'content' | 'stage';
  children?: ComponentChildren;
}

/** The layout every screen shares except Practice: optional back link, then eyebrow, title and actions. */
export function Screen({ title, eyebrow, eyebrowClip = false, back, actions, titleLang, width = 'content', children }: ScreenProps) {
  return (
    <div class={`screen screen-${width}`}>
      <header class="page-header">
        {back && (
          <a class={`back-link ${back.compactOnly ? 'only-compact' : ''}`} href={back.href}>
            <Icon name="back" />
            <span>{back.label}</span>
          </a>
        )}
        <div class="page-title-row">
          <div class="page-title">
            {eyebrow && <p class={eyebrowClip ? 'eyebrow eyebrow-clip' : 'eyebrow'} title={eyebrowClip ? eyebrow : undefined}>{eyebrow}</p>}
            {title !== null && <h1 lang={titleLang}>{title}</h1>}
          </div>
          {actions && <div class="page-actions">{actions}</div>}
        </div>
      </header>
      {children}
    </div>
  );
}

/** One short line and, at most, one way forward. */
export function EmptyState({ title, support, art, children }: { title: string; support?: string; art?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <section class="empty">
      {art}
      <div class="empty-text">
        <p class="empty-title">{title}</p>
        {support && <p class="empty-support">{support}</p>}
      </div>
      {children}
    </section>
  );
}

/** Only appears if reading takes noticeably long, so a normal visit never flickers. */
export const LoadingState = () => <p class="loading" role="status">{t.common.loading}</p>;

export const LoadError = ({ onRetry }: { onRetry: () => void }) => (
  <EmptyState title={t.common.loadFailed}>
    <button type="button" class="btn" onClick={onRetry}>{t.common.reload}</button>
  </EmptyState>
);

