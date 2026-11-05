/** One drawn set: 24 grid, 1.75 stroke, round joins. Size comes from CSS, so icons grow with the text. */
const PATHS = {
  today: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
  dictionary: 'M12 6.5C10.5 5 8 4.5 4 4.5v14c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-14c-4 0-6.5.5-8 2zM12 6.5v14',
  collections: 'M12 4l9 5-9 5-9-5zM3 14l9 5 9-5',
  practice: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 10h8M8 14h5',
  sidebar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM9.5 4v16',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 13l5-5 5 5M5 4h14',
  file: 'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5',
  forward: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  select: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.2l2.8 2.8L16 9.5',
  hint: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.1 1 1.9v.2h5v-.2c0-.8.4-1.4 1-1.9A6 6 0 0 0 12 3z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M5 19l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L9 18zM14.5 6.5l3 3',
  trash: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z',
  remove: 'M6 12h12',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5v.01',
  warning: 'M12 8v5M12 16.5v.01M10.3 4.3 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z',
  'arrow-left-right': 'M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4',
  eye: 'M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  // A small speaker: one wave at rest, two while it plays, a cross when it could not play.
  speaker: 'M3.5 9.5v5h4l4.5 4v-13l-4.5 4zM15.5 9.5a3.5 3.5 0 0 1 0 5',
  'speaker-on': 'M3.5 9.5v5h4l4.5 4v-13l-4.5 4zM15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10',
  'speaker-off': 'M3.5 9.5v5h4l4.5 4v-13l-4.5 4zM16 10l4 4M20 10l-4 4',
  'eye-off': 'M3 3l18 18M10.6 5.1Q11.3 5 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.9M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19a9.4 9.4 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
