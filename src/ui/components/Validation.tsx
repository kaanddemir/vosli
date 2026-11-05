import type { ComponentChildren } from 'preact';
import type { Issue, IssueCode, Suggestion, Validation } from '../../core/issues';
import { t } from '../../i18n/strings';

const suggestionName = (suggestion: Suggestion) => (suggestion.article ? `${suggestion.article} ${suggestion.german}` : suggestion.german);

/** What the dictionary noticed, then the changes it can offer, side by side with the closing action. Nothing changes until one is pressed. */
export function IssueList({ issues, silent = [], onApply, children }: { issues: readonly Issue[]; /** Already said by another warning: only the offer is shown. */ silent?: readonly IssueCode[]; onApply: (suggestion: Suggestion) => void; children: ComponentChildren }) {
  const offers = [...new Map(issues.flatMap((item) => item.suggestions).map((offer) => [suggestionName(offer), offer])).values()];
  return (
    <>
      {issues.filter((item) => !silent.includes(item.code)).map((item) => (
        <span key={item.code} class="popover-line" data-testid="validation-issue">{t.validation.issues[item.code]}{item.code === 'old_spelling' && item.suggestions.length === 0 ? ` ${t.validation.noCurrent}` : ''}</span>
      ))}
      <span class="issue-choices">
        {offers.map((offer) => (
          <button key={suggestionName(offer)} type="button" class="btn btn-small" lang="de" aria-label={t.validation.apply(suggestionName(offer))} onClick={() => onApply(offer)}>
            {suggestionName(offer)}
          </button>
        ))}
        {children}
      </span>
    </>
  );
}

/** One quiet line about a checked entry. Empty when there is no news, or when a warning already says it. */
export function validationText(validation: Validation): string {
  const { status, note } = validation;
  if (note?.kind === 'articles') return t.validation.articles(note.articles.join(', '));
  if (note?.kind === 'plural') return t.validation.plural;
  if (note?.kind === 'inflected') return t.validation.inflected(note.of);
  if (note?.kind === 'compound') return t.validation.compound(note.head);
  if (status === 'verified') return t.validation.verified;
  if (status === 'multiple') return t.validation.multiple;
  if (status === 'not_found') return t.validation.notFound;
  if (status === 'unchecked') return t.validation.unchecked;
  return '';
}
