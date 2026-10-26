import { createPathIndex, createRenderContext, usedImageIds } from '../paths';
import { renderDiagrams, type MermaidApi, type TokenReader } from '../preview/mermaid';
import { escapeHtml, render } from '../renderer';
import { toCssVars, type RenderingSettings } from '../settings';
import type { ProjectSnapshot } from '../store';
import { inlineCssUrls, pickFontFaces, type FetchBytes } from './assets';
import { dataUri } from './base64';
import { fileStem } from './files';

export type ExportMode = 'html' | 'pdf';

export interface ExportDeps {
  /** tokens.css + components.css + preview.css */
  baseCss: string;
  /** KaTeX's stylesheet; included only when the document has math. */
  mathCss: string;
  /** @font-face rules of the self-hosted fonts. */
  fontCss: string;
  fetchBytes: FetchBytes;
  loadMermaid?: () => Promise<MermaidApi>;
}

export interface ExportInput {
  markdown: string;
  /** The document's file name, e.g. "Intro.md". */
  title: string;
  folderId: string | null;
  snapshot: ProjectSnapshot;
  rendering: RenderingSettings;
  mode: ExportMode;
}

const EXPORT_CSS = `
body.mdit-export { margin: 0; background: var(--paper); color: var(--ink); }
@media print {
  @page { margin: 16mm; }
  body.mdit-export { background: none; }
  .mdit-export .md-prose { max-width: none; margin: 0; padding-block: 0; }
  .mdit-export figure.md-code, .mdit-export img, .mdit-export .md-mermaid, .mdit-export .katex-display, .mdit-export table { break-inside: avoid; }
  .mdit-export h1, .mdit-export h2, .mdit-export h3, .mdit-export h4, .mdit-export h5, .mdit-export h6 { break-after: avoid; }
  .mdit-export pre { white-space: pre-wrap; }
}`;

/** Copy buttons in the exported file: the clipboard API, or a hidden textarea where it is missing. */
const COPY_SCRIPT = `document.addEventListener('click', function (event) {
  var button = event.target instanceof Element ? event.target.closest('.md-code-copy') : null;
  if (!button) return;
  var figure = button.closest('.md-code');
  var pre = figure ? figure.querySelector('pre') : null;
  var text = pre ? pre.textContent : '';
  var label = button.querySelector('span');
  function done(ok) {
    if (!label) return;
    label.textContent = ok ? 'Copied' : 'Couldn\\u2019t copy';
    setTimeout(function () { label.textContent = 'Copy'; }, 1400);
  }
  function fallback() {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    area.remove();
    done(ok);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
  else fallback();
});`;

/** Values of the first `:root { … }` block of tokens.css, which is the light theme. */
export function lightTokens(css: string): TokenReader {
  const block = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const values = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) values.set(match[1]!, match[2]!.trim());
  return (name) => values.get(name) ?? '';
}

/** Mermaid lays diagrams out in the DOM, so they are rendered in an attached, offscreen container. */
async function renderDiagramsToHtml(body: string, deps: ExportDeps): Promise<string> {
  const host = document.createElement('div');
  host.dataset.exportHost = '';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:720px;';
  host.innerHTML = body;
  document.body.append(host);
  try {
    await renderDiagrams(host, 'light', deps.loadMermaid, lightTokens(deps.baseCss));
    return host.innerHTML;
  } finally {
    host.remove();
  }
}

function finishBody(html: string, mode: ExportMode): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const el of template.content.querySelectorAll('[data-doc-id], [data-missing]')) {
    el.removeAttribute('data-doc-id');
    el.removeAttribute('data-missing');
  }
  if (mode === 'pdf') for (const button of template.content.querySelectorAll('.md-code-copy')) button.remove();
  return template.innerHTML;
}

/** One HTML file that looks like the preview with the same settings, and needs no network (P-035). */
export async function buildExportHtml(input: ExportInput, deps: ExportDeps): Promise<string> {
  const { snapshot } = input;
  const index = createPathIndex(snapshot.folders, snapshot.documents, snapshot.images);
  const used = usedImageIds(input.markdown, input.folderId, index);
  const imageUrls = new Map(
    snapshot.images.filter((image) => used.has(image.id)).map((image) => [image.id, dataUri(image.contentType, new Uint8Array(image.bytes))] as const),
  );
  let body = render(input.markdown, createRenderContext({ loaded: true, index, docFolderId: input.folderId, imageUrls }));
  if (body.includes('md-mermaid')) body = await renderDiagramsToHtml(body, deps);
  body = finishBody(body, input.mode);

  const hasMath = body.includes('class="katex');
  const fonts = pickFontFaces(deps.fontCss, `${input.title}\n${input.markdown}`);
  const css = await inlineCssUrls([deps.baseCss, hasMath ? deps.mathCss : '', fonts, EXPORT_CSS].join('\n'), deps.fetchBytes);
  const vars = Object.entries(toCssVars(input.rendering))
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ');
  const script = input.mode === 'html' ? `<script>${COPY_SCRIPT}</script>` : '';
  return [
    '<!doctype html>',
    '<html lang="en" data-theme="light">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(fileStem(input.title))}</title>`,
    `<style>${css}</style>`,
    '</head>',
    `<body class="mdit-export"><main class="md-preview"><article class="md-prose" style="${escapeHtml(vars)}">${body}</article></main>${script}</body>`,
    '</html>',
  ].join('\n');
}
