import type { ComponentChildren, Ref } from 'preact';
import { Icon, type IconName } from './Icon';

/** A grouped list: the one surface used for rows of anything, on every screen. */
export function List({ label, footer, children }: { label?: string | undefined; footer?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="list-section">
      {label && <h2 class="list-label">{label}</h2>}
      <ul class="list">{children}</ul>
      {footer}
    </section>
  );
}

interface RowProps {
  title: ComponentChildren;
  icon?: IconName;
  detail?: ComponentChildren;
  /** Short text at the end of the row, such as a count or a status. */
  value?: ComponentChildren;
  valueTestId?: string;
  href?: string;
  onClick?: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  /** An action rather than a place to go: accent text and no chevron. */
  action?: boolean;
  disabled?: boolean;
  lang?: string;
  /** A separate control after the row, such as remove. It sits beside the link, never inside it. */
  trailing?: ComponentChildren;
}

export function Row({ title, icon, detail, value, valueTestId, href, onClick, buttonRef, action, disabled, lang, trailing }: RowProps) {
  const body = (
    <>
      {icon && <Icon name={icon} />}
      <span class="row-text">
        <span class="row-title" lang={lang}>{title}</span>
        {detail && <span class="row-detail">{detail}</span>}
      </span>
      {value !== undefined && <span class="row-value" data-testid={valueTestId}>{value}</span>}
      {href && <span class="row-chevron"><Icon name="forward" /></span>}
    </>
  );
  const className = `row ${action ? 'row-action' : ''}`;
  return (
    <li class={trailing ? 'list-item list-item-split' : 'list-item'}>
      {href ? (
        <a class={`${className} row-press`} href={href}>{body}</a>
      ) : onClick ? (
        <button ref={buttonRef ?? null} type="button" class={`${className} row-press`} disabled={disabled} onClick={onClick}>{body}</button>
      ) : (
        <div class={className}>{body}</div>
      )}
      {trailing}
    </li>
  );
}
