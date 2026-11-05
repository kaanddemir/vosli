import { useState } from 'preact/hooks';
import type { Issue } from '../../core/issues';
import type { Word } from '../../data/types';
import { formatCount } from '../../i18n/format';
import { t } from '../../i18n/strings';
import { hrefForWordEdit } from '../router';
import { Icon } from './Icon';
import { List, Row } from './List';
import { Modal } from './Modal';
import { wordLabel } from './WordList';

interface FlaggedWordsProps {
  words: readonly Word[];
  issuesOf: (wordId: string) => readonly Issue[];
  include: boolean;
  onInclude: (include: boolean) => void;
}

/** Words with an open dictionary warning wait unless asked for. From here each can be opened and put right. */
export function FlaggedWords({ words, issuesOf, include, onInclude }: FlaggedWordsProps) {
  const [reviewing, setReviewing] = useState(false);
  return (
    <>
      <section class="setup-flagged" data-testid="practice-flagged">
        <p class="setup-flagged-line">
          <Icon name="warning" />
          <span>{t.practice.flaggedCount(formatCount(words.length))}</span>
          <button type="button" class="link-btn" onClick={() => setReviewing(true)}>{t.practice.reviewFlagged}</button>
        </p>
        <label class="check-row setup-flagged-check">
          <input type="checkbox" checked={include} onChange={(event) => onInclude(event.currentTarget.checked)} />
          <span>{t.practice.includeFlagged}</span>
        </label>
      </section>
      {reviewing && (
        <Modal titleId="flagged-title" onClose={() => setReviewing(false)}>
          <h2 id="flagged-title">{t.practice.flaggedTitle}</h2>
          <p class="form-hint">{t.practice.flaggedBody}</p>
          <div class="dialog-list">
            <List>
              {words.map((word) => (
                <Row key={word.id} lang="de" title={wordLabel(word)} detail={<span lang="tr">{issuesOf(word.id).map((item) => t.validation.issues[item.code]).join(' ')}</span>} href={hrefForWordEdit(word.id)} />
              ))}
            </List>
          </div>
          <div class="btn-row">
            <button type="button" class="btn" onClick={() => setReviewing(false)}>{t.common.close}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
