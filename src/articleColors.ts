/** Also read by public/theme-boot.js, so colored articles are there from the first paint. */
export const ARTICLE_COLORS_STORAGE_KEY = 'vosli.article-colors';

/** Off unless the learner turned it on. Anything else stored there reads as off. */
export function parseArticleColors(value: string | null): boolean {
  return value === 'on';
}

export function loadArticleColors(): boolean {
  try {
    return parseArticleColors(localStorage.getItem(ARTICLE_COLORS_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** One attribute on the root: every article on screen follows it, with no screen holding its own copy. */
function apply(on: boolean): void {
  if (on) document.documentElement.dataset.articleColors = 'on';
  else delete document.documentElement.dataset.articleColors;
}

export function saveArticleColors(on: boolean): void {
  try {
    if (on) localStorage.setItem(ARTICLE_COLORS_STORAGE_KEY, 'on');
    else localStorage.removeItem(ARTICLE_COLORS_STORAGE_KEY);
  } catch {
    // Storage may be blocked. The choice still applies for this visit.
  }
  apply(on);
}

export function initArticleColors(): void {
  apply(loadArticleColors());
}
