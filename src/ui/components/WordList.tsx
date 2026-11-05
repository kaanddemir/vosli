import type { ComponentChildren, Ref } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Word } from '../../data/types';
import { t } from '../../i18n/strings';
import type { DictionaryDirection } from '../dictionaryView';
import { hrefForWord } from '../router';
import { Icon } from './Icon';
import { List } from './List';
import { SpeakerButton } from './SpeakerButton';

const PAGE = 100;

export const meaningsOf = (word: Pick<Word, 'meanings'>): string => word.meanings.map((meaning) => meaning.text).join(', ');

export const wordLabel = (word: Pick<Word, 'article' | 'lemma'>): string => (word.article ? `${word.article} ${word.lemma}` : word.lemma);

/**
 * The article is quieter than the word, so the eye lands on what is being learned. A title keeps it at
 * full strength. With article colors on, the article alone takes its gender's color; the space after it
 * stays outside, so an underline or selection never runs into the word.
 */
export const GermanWord = ({ word, quiet = true }: { word: Pick<Word, 'article' | 'lemma'>; quiet?: boolean }) => (
  <>
    {word.article && <><span class={`${quiet ? 'article ' : ''}article-${word.article}`}>{word.article}</span>{' '}</>}
    {word.lemma}
  </>
);

const Favorite = () => (
  <span class="favorite-mark">
    <Icon name="star" filled />
    <span class="visually-hidden">{t.dictionary.favorite}</span>
  </span>
);

/** The star alone, where its name is already read out as part of the row's link. */
const FavoriteMark = () => (
  <span class="row-value" aria-hidden="true">
    <span class="favorite-mark"><Icon name="star" filled /></span>
  </span>
);

/** Choosing rather than opening: the rows become checkboxes, and paging works the same. */
interface Selection {
  ids: ReadonlySet<string>;
  onToggle: (word: Word, on: boolean) => void;
}

/**
 * The Dictionary's memorizing view. Turkish first swaps the two lines. Hidden covers the second line of
 * every row until that row alone is revealed. Other lists leave it out and look as they always have.
 */
export interface ListView {
  direction: DictionaryDirection;
  hidden: boolean;
  revealed: ReadonlySet<string>;
  onReveal: (word: Word) => void;
}

/** Takes focus once, when it replaces the button that revealed it, so a screen reader reads the answer out. */
function RevealedAnswer({ lang, focus, onFocused, children }: { lang: string; focus: boolean; onFocused: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.focus();
    // Once only: a later search or page of results must not pull focus back here.
    onFocused();
  }, []);
  return <span ref={ref as Ref<HTMLSpanElement>} class="row-detail row-answer" lang={lang} tabIndex={-1}>{children}</span>;
}

export function WordList({ words, groupId, onRemove, selection, view }: { words: readonly Word[]; groupId?: string; onRemove?: (word: Word) => void; selection?: Selection | undefined; view?: ListView | undefined }) {
  const [shown, setShown] = useState(PAGE);
  const focusAnswer = useRef<string | null>(null);
  const turkishFirst = view?.direction === 'tr_de';
  const german = (word: Word) => <GermanWord word={word} />;
  // Which side leads, with its language, so a screen reader reads each line in the right voice.
  const sides = (word: Word) =>
    turkishFirst
      ? { top: meaningsOf(word), topLang: 'tr', bottom: german(word), bottomLang: 'de' }
      : { top: german(word), topLang: 'de', bottom: meaningsOf(word), bottomLang: 'tr' };

  return (
    <>
      <List>
        {words.slice(0, shown).map((word) => {
          const { top, topLang, bottom, bottomLang } = sides(word);
          if (selection) {
            // Choosing words to delete needs both sides in view, so nothing is covered here.
            return (
              <li key={word.id} class="list-item">
                <label class="check-row select-row">
                  <input type="checkbox" checked={selection.ids.has(word.id)} onChange={(event) => selection.onToggle(word, event.currentTarget.checked)} />
                  <span class="row-text">
                    <span class="row-title" lang={topLang}>{top}</span>
                    <span class="row-detail" lang={bottomLang}>{bottom}</span>
                  </span>
                  {word.favoritedAt !== null && <span class="row-value"><Favorite /></span>}
                </label>
              </li>
            );
          }
          if (view?.hidden) {
            const revealed = view.revealed.has(word.id);
            const label = turkishFirst ? t.dictionary.revealGerman(meaningsOf(word)) : t.dictionary.revealMeaning(wordLabel(word));
            // The link covers the row, so the whole row still opens the word. The reveal button sits above it,
            // so a press there only uncovers the answer and never opens the word as well.
            return (
              <li key={word.id} class="list-item">
                <div class="row row-stretch">
                  <span class="row-text">
                    <a class="row-title row-link" href={hrefForWord(word.id, groupId)} lang={topLang}>{top}</a>
                    {revealed ? (
                      <RevealedAnswer lang={bottomLang} focus={focusAnswer.current === word.id} onFocused={() => (focusAnswer.current = null)}>{bottom}</RevealedAnswer>
                    ) : (
                      // Only a label is rendered: the answer itself is not on the page until it is asked for.
                      <button
                        type="button"
                        class="row-reveal"
                        aria-label={label}
                        title={label}
                        data-testid="reveal-answer"
                        onClick={() => {
                          focusAnswer.current = word.id;
                          view.onReveal(word);
                        }}
                      >
                        <Icon name="eye" />
                        <span aria-hidden="true">{t.dictionary.reveal}</span>
                      </button>
                    )}
                  </span>
                  {word.favoritedAt !== null && <span class="row-value"><Favorite /></span>}
                  {/* German covered below the Turkish stays silent until that row is revealed. */}
                  {(!turkishFirst || revealed) && <SpeakerButton word={word} class="row-speaker" />}
                  <span class="row-chevron"><Icon name="forward" /></span>
                </div>
              </li>
            );
          }
          // The link covers the row, so the row and its chevron open the word as before. The speaker and the
          // remove button sit above it: separate targets beside the link, never inside it.
          return (
            <li key={word.id} class="list-item">
              <div class="row row-press row-stretch">
                <a class="row-text row-link" href={hrefForWord(word.id, groupId)}>
                  <span class="row-title" lang={topLang}>{top}</span>
                  <span class="row-detail"><span lang={bottomLang}>{bottom}</span></span>
                  {word.favoritedAt !== null && <span class="visually-hidden">{t.dictionary.favorite}</span>}
                </a>
                {word.favoritedAt !== null && <FavoriteMark />}
                <SpeakerButton word={word} class="row-speaker" />
                {onRemove ? (
                  <button type="button" class="icon-btn row-over" aria-label={t.collections.remove(wordLabel(word))} title={t.collections.remove(wordLabel(word))} onClick={() => onRemove(word)}>
                    <Icon name="remove" />
                  </button>
                ) : (
                  <span class="row-chevron"><Icon name="forward" /></span>
                )}
              </div>
            </li>
          );
        })}
      </List>
      {words.length > shown && (
        <button type="button" class="btn btn-quiet btn-block" onClick={() => setShown(shown + PAGE)}>{t.common.more}</button>
      )}
    </>
  );
}
