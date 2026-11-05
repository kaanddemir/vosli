import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from './Icon';

const hasPopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
const MARGIN = 8;

interface PopoverButtonProps {
  id: string;
  icon: IconName;
  /** Spoken name of the button, saying what it explains. */
  label: string;
  /** Accent color: there is something here worth reading. */
  attention?: boolean;
  /** Pressing it leaves focus where it is, so a phone keyboard stays open. */
  keepFocus?: boolean;
  /** A word beside the icon, where the icon alone would be too easy to miss. */
  text?: string;
  children: ComponentChildren;
}

/**
 * An icon that holds an explanation until asked. Tap, click, Enter and Space all open it, and
 * Escape or a tap elsewhere closes it, with nothing depending on hover. The explanation comes right
 * after the button in reading order. Browsers without popovers show it in place instead.
 */
export function PopoverButton({ id, icon, label, attention = false, keepFocus = false, text, children }: PopoverButtonProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);

  /** Opens from the icon, above it when too near the bottom. Width comes from the stylesheet's own limit. */
  const place = (event: Event) => {
    if ((event as ToggleEvent).newState !== 'open' || !button.current || !panel.current) return;
    const anchor = button.current.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const viewport = document.documentElement.clientWidth;
    const width = Math.min(18 * rem, viewport - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(anchor.left + anchor.width / 2 - 1.5 * rem, viewport - width - MARGIN));
    const above = anchor.bottom + 14 * rem > window.innerHeight;
    const style = panel.current.style;
    style.left = `${left + window.scrollX}px`;
    style.top = `${(above ? anchor.top : anchor.bottom) + window.scrollY}px`;
    panel.current.dataset.side = above ? 'above' : 'below';
  };

  /** The panel is as wide as its text, which can only be measured once open: a short one stays by its icon. */
  const settle = (event: Event) => {
    const isOpen = (event as ToggleEvent).newState === 'open';
    setOpen(isOpen);
    if (!isOpen || !button.current || !panel.current) return;
    const anchor = button.current.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const left = Math.max(MARGIN, Math.min(anchor.left + anchor.width / 2 - 1.5 * rem, viewport - panel.current.offsetWidth - MARGIN));
    panel.current.style.left = `${left + window.scrollX}px`;
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        class={`icon-btn ${attention ? 'icon-btn-on' : ''} ${text ? 'icon-btn-text' : ''}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        {...(keepFocus ? { onMouseDown: (event: MouseEvent) => event.preventDefault() } : {})}
        {...(hasPopover ? { popovertarget: id } : { onClick: () => setOpen(!open) })}
      >
        <Icon name={icon} />
        {text && <span>{text}</span>}
      </button>
      <span
        ref={panel}
        id={id}
        lang="tr"
        role="group"
        aria-label={label}
        class="popover-panel"
        {...(hasPopover ? { popover: 'auto', onBeforeToggle: place, onToggle: settle } : { hidden: !open })}
      >
        {children}
      </span>
    </>
  );
}
