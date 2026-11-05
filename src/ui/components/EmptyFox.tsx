/** Vosli beside what the screen will hold: words in a book, collections in a box, favorites in its paws. Decorative, and drawn only from tokens so it follows the theme. */
const Fox = () => <image href="./icons/vosli-mark.svg" x="62" y="12" width="96" height="96" />;

export function EmptyFox({ scene }: { scene: 'book' | 'box' | 'heart' }) {
  return (
    <svg class="empty-fox" viewBox="0 0 220 136" aria-hidden="true">
      {scene === 'book' && (
        <>
          <text class="empty-fox-letter" x="34" y="52" transform="rotate(-10 34 52)">ä</text>
          <text class="empty-fox-letter" x="172" y="44" transform="rotate(9 172 44)">ß</text>
          <Fox />
          <path class="empty-fox-cover" d="M110 132c-22-11-56-11-86-3V88h172v41c-30-8-64-8-86 3z" />
          <path class="empty-fox-paper" d="M110 92C90 80 58 79 32 85v39c26-6 58-5 78 7zM110 92c20-12 52-13 78-7v39c-26-6-58-5-78 7z" />
          <path class="empty-fox-line" d="M46 97c15-2 31-1 48 5M46 109c15-2 31-1 48 5M174 97c-15-2-31-1-48 5M174 109c-15-2-31-1-48 5" />
        </>
      )}
      {scene === 'box' && (
        <>
          <rect class="flag-gold" x="42" y="42" width="36" height="56" rx="5" transform="rotate(-13 60 70)" />
          <rect class="flag-cream" x="142" y="40" width="36" height="56" rx="5" transform="rotate(12 160 68)" />
          <rect class="flag-red" x="160" y="54" width="32" height="50" rx="5" transform="rotate(24 176 79)" />
          <Fox />
          <path class="empty-fox-paper" d="M44 92h132a6 6 0 0 1 6 6v26a8 8 0 0 1-8 8H46a8 8 0 0 1-8-8V98a6 6 0 0 1 6-6z" />
          <rect class="empty-fox-tag" x="92" y="104" width="36" height="14" rx="4" />
        </>
      )}
      {scene === 'heart' && (
        <>
          <path class="empty-fox-spark" d="M40 38l3.4 7 7.6 1-5.5 5.300 1.300 7.700-6.800-3.600-6.800 3.600 1.300-7.700L29 46l7.600-1z" />
          <path class="empty-fox-spark" d="M178 56c-7-5-11-9-11-14 0-6 8-8 11-2 3-6 11-4 11 2 0 5-4 9-11 14z" />
          <Fox />
          <ellipse class="empty-fox-paw" cx="86" cy="108" rx="9" ry="7" transform="rotate(24 86 108)" />
          <ellipse class="empty-fox-paw" cx="134" cy="108" rx="9" ry="7" transform="rotate(-24 134 108)" />
          <path class="empty-fox-heart" d="M110 132C78 110 84 86 98 86c6 0 10 4 12 9 2-5 6-9 12-9 14 0 20 24-12 46z" />
        </>
      )}
    </svg>
  );
}
