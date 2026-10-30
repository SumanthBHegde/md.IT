export type IconName =
  | 'file' | 'folder' | 'folder-open' | 'chevron-right' | 'chevron-down' | 'plus' | 'search' | 'copy'
  | 'check' | 'x' | 'more' | 'columns' | 'pencil' | 'eye' | 'history' | 'cloud' | 'alert' | 'info'
  | 'trash' | 'download' | 'image' | 'sliders' | 'sidebar' | 'user'
  // App extensions (P-097), drawn on the same grid.
  | 'undo' | 'redo' | 'bold' | 'italic' | 'strikethrough' | 'highlight' | 'code' | 'list-bullet' | 'list-numbered'
  | 'list-check' | 'quote' | 'code-block' | 'minus' | 'link' | 'table' | 'sigma' | 'diagram' | 'panel-right'
  | 'keyboard' | 'sun' | 'moon';

type IconPath = readonly [d: string, strokeWidth?: number];

/** Paths copied from the design system bundle: 24px grid, 1.5 stroke, round caps and joins. */
export const ICONS: Record<IconName, readonly IconPath[]> = {
  file: [['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'], ['M14 3v5h5']],
  folder: [['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z']],
  'folder-open': [
    ['M3 17V7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1'],
    ['M3 17l2.3-5.8A2 2 0 0 1 7.2 10H21l-2.5 7.6A2 2 0 0 1 16.6 19H5a2 2 0 0 1-2-2z'],
  ],
  'chevron-right': [['M9.5 6.5l5.5 5.5-5.5 5.5']],
  'chevron-down': [['M6.5 9.5l5.5 5.5 5.5-5.5']],
  plus: [['M12 5v14M5 12h14']],
  search: [['M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z'], ['M20 20l-4.3-4.3']],
  copy: [
    ['M10 8h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z'],
    ['M15 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4'],
  ],
  check: [['M5 12.5l4.5 4.5L19 7.5']],
  x: [['M6.5 6.5l11 11M17.5 6.5l-11 11']],
  more: [['M6 12h.01M12 12h.01M18 12h.01', 2.6]],
  columns: [['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'], ['M12 4v16']],
  pencil: [['M4 20h4L19.3 8.7a2.1 2.1 0 0 0-3-3L5 17v3'], ['M14.5 7.5l2 2']],
  eye: [
    ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'],
    ['M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z'],
  ],
  history: [['M3.5 12A8.5 8.5 0 1 0 6 6'], ['M3.5 3.5V8H8'], ['M12 8v4l3 2']],
  cloud: [['M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.3 9.3 4.6 4.6 0 0 0 7 18.5z']],
  alert: [
    ['M10.3 4.9a2 2 0 0 1 3.4 0l7.1 12.4a2 2 0 0 1-1.7 3H4.9a2 2 0 0 1-1.7-3z'],
    ['M12 10v4'],
    ['M12 17h.01', 2.4],
  ],
  info: [['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'], ['M12 11v5'], ['M12 8h.01', 2.4]],
  trash: [['M4 7h16'], ['M10 11v6M14 11v6'], ['M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12'], ['M9 7V4h6v3']],
  download: [['M12 4v11'], ['M7 10l5 5 5-5'], ['M5 20h14']],
  image: [
    ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'],
    ['M4 16l5-5 4 4 2-2 5 5'],
    ['M16 8.5h.01', 2.6],
  ],
  sliders: [['M4 7h10M18 7h2M4 17h4M12 17h8'], ['M16 5v4M10 15v4']],
  sidebar: [['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'], ['M9.5 4v16']],
  user: [['M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'], ['M4.5 20.5a7.5 7.5 0 0 1 15 0']],
  undo: [['M8 5 3.5 9.5 8 14'], ['M3.5 9.5H14a5.5 5.5 0 0 1 0 11h-3']],
  redo: [['M16 5l4.5 4.5L16 14'], ['M20.5 9.5H10a5.5 5.5 0 0 0 0 11h3']],
  bold: [['M7 5h6a3.5 3.5 0 0 1 0 7H7z', 2], ['M7 12h7a3.5 3.5 0 0 1 0 7H7z', 2]],
  italic: [['M10 5h7'], ['M7 19h7'], ['M14 5l-4 14']],
  strikethrough: [
    ['M4 12h16'],
    ['M16.5 7.5C16 5.8 14.2 5 12 5c-2.6 0-4.5 1.3-4.5 3.4 0 1.4.8 2.4 2.2 3'],
    ['M8 16c.5 1.9 2 3 4.3 3 2.7 0 4.5-1.3 4.5-3.4 0-.8-.2-1.5-.6-2.1'],
  ],
  highlight: [['M14.5 4.5l5 5L10 19H5v-5z'], ['M4 21.5h16']],
  code: [['M8.5 7l-5 5 5 5'], ['M15.5 7l5 5-5 5']],
  'list-bullet': [['M9 6h11M9 12h11M9 18h11'], ['M4.5 6h.01M4.5 12h.01M4.5 18h.01', 2.4]],
  'list-numbered': [['M10 6h10M10 12h10M10 18h10'], ['M4 5l1.5-1v5'], ['M4 14.5c.3-.9 2.6-1 2.6.4 0 1-2.6 2-2.6 3.6h2.8']],
  'list-check': [['M11 6h9M11 12h9M11 18h9'], ['M4 6l1.5 1.5L8 5'], ['M4 12l1.5 1.5L8 11'], ['M4 18l1.5 1.5L8 17']],
  quote: [
    ['M10 7H6a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v.5c0 1.5-1 2.5-2.5 3'],
    ['M19 7h-4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v.5c0 1.5-1 2.5-2.5 3'],
  ],
  'code-block': [
    ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'],
    ['M10 9.5 7.5 12l2.5 2.5'],
    ['M14 9.5l2.5 2.5-2.5 2.5'],
  ],
  minus: [['M4 12h16']],
  link: [
    ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1'],
    ['M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  ],
  table: [['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'], ['M4 9.5h16M4 14.5h16M10 4v16']],
  sigma: [['M18 5H6l6.5 7L6 19h12']],
  diagram: [['M9 4h6v5H9z'], ['M3.5 15h6v5h-6z'], ['M14.5 15h6v5h-6z'], ['M12 9v3M6.5 15v-3h11v3']],
  'panel-right': [['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'], ['M14.5 4v16']],
  keyboard: [
    ['M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z'],
    ['M7 10h.01M11 10h.01M15 10h.01M18 10h.01', 2.2],
    ['M8 14.5h8'],
  ],
  sun: [
    ['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'],
    ['M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4'],
  ],
  moon: [['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z']],
};
