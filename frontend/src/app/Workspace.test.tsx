import { EditorView } from '@codemirror/view';
import { strFromU8, unzipSync } from 'fflate';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addImage, clearDatabase, createDocument, createFolder, createProject, getSetting, listFolders, saveDocumentContent, setSetting, SETTINGS } from '../store';
import { Workspace } from './Workspace';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>Project list</p>} />
        <Route path="/p/:projectId" element={<Workspace />} />
        <Route path="/p/:projectId/d/:docId" element={<Workspace />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function projectWithDocument(content = '# Hello\n\nWorld') {
  const project = await createProject('OS');
  const doc = await createDocument(project.id, null, 'Intro');
  await saveDocumentContent(doc.id, content);
  return { project, doc };
}

const pngFile = (name: string) => new File(['x'], name, { type: 'image/png' });
const pngBytes = (name: string) => ({ name, type: 'image/png', bytes: new TextEncoder().encode('x').buffer as ArrayBuffer });
const fileInput = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[type="file"]')!;
const editorText = (container: HTMLElement) => container.querySelector('.cm-content')?.textContent ?? '';

const saved = vi.hoisted(() => [] as Array<{ name: string; blob: Blob }>);
vi.mock('../export/download', () => ({
  download: (name: string, blob: Blob) => saved.push({ name, blob }),
  bytesBlob: (bytes: Uint8Array, type: string) => new Blob([new Uint8Array(bytes)], { type }),
}));

beforeEach(async () => {
  saved.length = 0;
  await clearDatabase();
});

describe('Workspace', () => {
  it('says so when the project is not in this browser', async () => {
    renderAt('/p/nope');
    expect(await screen.findByText('This project isn’t in this browser')).toBeInTheDocument();
  });

  it('shows the project name and an empty main area with no document open', async () => {
    const project = await createProject('OS');
    renderAt(`/p/${project.id}`);
    expect(await screen.findByText('OS')).toBeInTheDocument();
    expect(await screen.findByText('No document open')).toBeInTheDocument();
  });

  it('renders the open document in the preview and says it is saved locally', async () => {
    const { project, doc } = await projectWithDocument();
    renderAt(`/p/${project.id}/d/${doc.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Hello' })).toBeInTheDocument();
    // Two live regions now: the save status and the (empty) notice.
    await waitFor(() => expect(screen.getAllByRole('status').some((el) => el.textContent?.includes('Saved locally'))).toBe(true));
    expect(await screen.findByRole('treeitem', { name: 'Intro.md' })).toHaveAttribute('aria-selected', 'true');
  });

  it('applies the rendering settings to the preview', async () => {
    const { project, doc } = await projectWithDocument();
    await setSetting(SETTINGS.rendering, { font: 'sans', letterSpacing: 0, lineHeight: 2, margin: 0, padding: 16 });
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    const prose = () => container.querySelector<HTMLElement>('.md-prose')!;
    await waitFor(() => expect(prose().style.getPropertyValue('--doc-line-height')).toBe('2'));
    expect(prose().style.getPropertyValue('--doc-font')).toBe('var(--font-sans)');
    expect(prose().style.getPropertyValue('--doc-padding')).toBe('16px');
  });

  it('shows the outline in the side panel and scrolls the preview to a heading', async () => {
    const user = userEvent.setup();
    const { project, doc } = await projectWithDocument('# Hello\n\nWorld\n\n## Next');
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    await user.click(screen.getByRole('button', { name: 'Show panel' }));
    const outline = await screen.findByRole('navigation', { name: 'Outline' });
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    await user.click(within(outline).getByRole('button', { name: 'Next' }));
    expect(scroll.mock.contexts).toContain(container.querySelector('.ws-preview [data-line="4"]'));
    scroll.mockRestore();
    expect(screen.getByRole('button', { name: 'Hide panel' })).toBeInTheDocument();
    await waitFor(async () => expect(await getSetting(SETTINGS.panel, false)).toBe(true));
  });

  it('changes the rendering settings from the side panel', async () => {
    const user = userEvent.setup();
    const { project, doc } = await projectWithDocument();
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    await user.click(screen.getByRole('button', { name: 'Show panel' }));
    await user.click(await screen.findByRole('radio', { name: 'Settings' }));
    fireEvent.change(await screen.findByRole('slider', { name: 'Padding' }), { target: { value: '16' } });
    expect(container.querySelector<HTMLElement>('.md-prose')!.style.getPropertyValue('--doc-padding')).toBe('16px');
    await waitFor(async () => expect(await getSetting(SETTINGS.rendering, null)).toMatchObject({ padding: 16 }));
  });

  it('searches the project and opens a match selected in the editor', async () => {
    const user = userEvent.setup();
    const project = await createProject('OS');
    const alpha = await createDocument(project.id, null, 'Alpha');
    await saveDocumentContent(alpha.id, '# Alpha\n\nnothing here');
    const beta = await createDocument(project.id, null, 'Beta');
    await saveDocumentContent(beta.id, 'intro\n\nfind the needle here');
    const { container } = renderAt(`/p/${project.id}/d/${alpha.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Alpha' });
    await user.type(screen.getByRole('searchbox', { name: 'Search project' }), 'needle');
    await user.click(await screen.findByRole('button', { name: /Line 3/ }));
    await waitFor(() => expect(editorText(container)).toContain('find the needle here'));
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
    await waitFor(() => expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('needle'));
  });

  it('focuses search with Ctrl+Shift+F and clears it with Escape', async () => {
    const user = userEvent.setup();
    const { project, doc } = await projectWithDocument();
    renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true });
    const box = screen.getByRole('searchbox', { name: 'Search project' });
    expect(box).toHaveFocus();
    await user.type(box, 'zzz');
    expect(await screen.findByText('No matches for “zzz”')).toBeInTheDocument();
    expect(screen.queryByRole('tree')).toBeNull();
    await user.keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(await screen.findByRole('tree', { name: 'Files' })).toBeInTheDocument();
  });

  it('includes the text typed just now in the project zip', async () => {
    const user = userEvent.setup();
    const { project, doc } = await projectWithDocument('# Hello');
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '\n\nJust typed' } }));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export project (.zip)' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const files = unzipSync(new Uint8Array(await saved[0]!.blob.arrayBuffer()));
    expect(strFromU8(files['OS/Intro.md']!)).toBe('# Hello\n\nJust typed');
  });

  it('exports the text typed just now', async () => {
    const user = userEvent.setup();
    const { project, doc } = await projectWithDocument('# Hello');
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '\n\nJust typed' } }));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export Markdown' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe('Intro.md');
    expect(await saved[0]!.blob.text()).toBe('# Hello\n\nJust typed');
  });

  it('says so when the document is missing', async () => {
    const project = await createProject('OS');
    renderAt(`/p/${project.id}/d/nope`);
    expect(await screen.findByText('This document isn’t in this project')).toBeInTheDocument();
  });

  it('opens a document from the tree', async () => {
    const user = userEvent.setup();
    const { project } = await projectWithDocument('# From tree');
    renderAt(`/p/${project.id}`);
    await user.click(await screen.findByRole('treeitem', { name: 'Intro.md' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'From tree' })).toBeInTheDocument();
  });

  it('switches to preview-only and remembers it', async () => {
    const user = userEvent.setup();
    const { project, doc } = await projectWithDocument();
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await user.click(await screen.findByRole('radio', { name: 'Preview' }));
    await waitFor(() => expect(container.querySelector('.ws-main')).toHaveClass('mode-preview'));
    expect(await getSetting(SETTINGS.mode, 'split')).toBe('preview');
  });

  it('returns to the project when the open document is deleted', async () => {
    const user = userEvent.setup();
    const { project, doc } = await projectWithDocument();
    renderAt(`/p/${project.id}/d/${doc.id}`);
    await user.click(await screen.findByRole('button', { name: 'Actions for Intro.md' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete document' }));
    expect(await screen.findByText('No document open')).toBeInTheDocument();
  });

  it('keeps Ctrl+S from reaching the browser anywhere on the page', async () => {
    const { project, doc } = await projectWithDocument();
    renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    const event = createEvent.keyDown(window, { key: 's', ctrlKey: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps relative links inside the app and says why', async () => {
    const { project, doc } = await projectWithDocument('<a href="/elsewhere">Away</a>');
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    fireEvent.click(await screen.findByRole('link', { name: 'Away' }));
    // SaveStatus is also role="status", so address the notice region directly.
    const notice = () => container.querySelector('.ws-notice')!;
    await waitFor(() => expect(notice()).toHaveTextContent('Only links to documents in this project open here.'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(notice()).toBeEmptyDOMElement();
  });

  it('Insert image stores the file next to the document and writes Markdown', async () => {
    const { project, doc } = await projectWithDocument('# Hello');
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    expect(screen.getByRole('button', { name: 'Insert image' })).toBeEnabled();
    fireEvent.change(fileInput(container), { target: { files: [pngFile('Screen Shot.png')] } });
    expect(await screen.findByRole('treeitem', { name: 'images' })).toBeInTheDocument();
    await waitFor(() => expect(editorText(container)).toContain('![screen-shot](images/screen-shot.png)'));
    await waitFor(() => expect(container.querySelector('.md-prose img')?.getAttribute('src')).toMatch(/^blob:test\//));
    expect(screen.getByRole('heading', { level: 1, name: 'Hello' })).toBeInTheDocument(); // the image didn't join the heading
  });

  it('shows the open document’s name in the header', async () => {
    const { project, doc } = await projectWithDocument();
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await waitFor(() => expect(container.querySelector('.ws-document')).toHaveTextContent('Intro.md'));
  });

  it('creates and opens a document from the empty state', async () => {
    const project = await createProject('OS');
    const { container } = renderAt(`/p/${project.id}`);
    const empty = (await screen.findByText('No document open')).closest<HTMLElement>('.ws-empty')!;
    await userEvent.click(within(empty).getByRole('button', { name: 'New document' }));
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
  });

  it('hides the file tree and remembers it; Ctrl+\\ brings it back', async () => {
    const { project, doc } = await projectWithDocument();
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    const tree = () => container.querySelector('.ws-tree')!;
    await userEvent.click(await screen.findByRole('button', { name: 'Hide file tree (Ctrl+\\)' }));
    await waitFor(() => expect(tree()).toHaveAttribute('hidden'));
    expect(screen.queryByRole('separator', { name: 'Resize file tree' })).not.toBeInTheDocument();
    await waitFor(async () => expect(await getSetting(SETTINGS.tree, true)).toBe(false));
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
    await waitFor(() => expect(tree()).not.toHaveAttribute('hidden'));
    expect(screen.getByRole('separator', { name: 'Resize file tree' })).toBeInTheDocument();
  });

  it('Ctrl+Shift+F opens a hidden tree and focuses search', async () => {
    await setSetting(SETTINGS.tree, false);
    const { project, doc } = await projectWithDocument();
    renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('button', { name: 'Show file tree (Ctrl+\\)' });
    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveFocus());
  });

  it('opens keyboard shortcuts from the header and with F1', async () => {
    const { project, doc } = await projectWithDocument();
    renderAt(`/p/${project.id}/d/${doc.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Keyboard shortcuts (F1)' }));
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F1' });
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('adds an image but doesn’t insert it into a document opened meanwhile', async () => {
    const { project, doc } = await projectWithDocument('# Hello');
    const other = await createDocument(project.id, null, 'Other');
    await saveDocumentContent(other.id, 'Other text');
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    fireEvent.change(fileInput(container), { target: { files: [pngFile('late.png')] } });
    fireEvent.click(await screen.findByText('Other.md'));
    await waitFor(() => expect(container.querySelector('.ws-notice')).toHaveTextContent('wasn’t inserted'));
    await waitFor(() => expect(editorText(container)).toContain('Other text'));
    expect(editorText(container)).not.toContain('late.png');
    expect(await screen.findByRole('treeitem', { name: 'images' })).toBeInTheDocument();
  });

  it('reports refused files in a notice and creates no folder', async () => {
    const { project, doc } = await projectWithDocument('# Hello');
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    await waitFor(() => expect(container.querySelector('.ws-notice')).toHaveTextContent('“notes.txt” isn’t a supported image (PNG, JPEG, GIF, WebP or SVG).'));
    expect(await listFolders(project.id)).toEqual([]);
  });

  it('shows a stored image referenced by a relative path, and a placeholder for a missing one', async () => {
    const project = await createProject('OS');
    const folder = await createFolder(project.id, null, 'images');
    await addImage(project.id, folder.id, pngBytes('a.png'));
    const doc = await createDocument(project.id, null, 'Intro');
    await saveDocumentContent(doc.id, '![A](images/a.png){width=50% align=right}\n\n![B](images/gone.png)');
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await waitFor(() => expect(container.querySelector('.md-prose img')?.getAttribute('src')).toMatch(/^blob:test\//));
    const img = container.querySelector('.md-prose img')!;
    expect(img.getAttribute('width')).toBe('50%');
    expect(img.getAttribute('data-align')).toBe('right');
    expect(await screen.findByText('Image not found: images/gone.png')).toBeInTheDocument();
  });

  it('opens a relative link to another document, and explains a missing one', async () => {
    const project = await createProject('OS');
    const other = await createDocument(project.id, null, 'Other');
    await saveDocumentContent(other.id, '# Other page');
    const doc = await createDocument(project.id, null, 'Intro');
    await saveDocumentContent(doc.id, '[Go](Other.md) and [Gone](Gone.md)');
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await waitFor(() => expect(container.querySelector('a[data-missing]')).not.toBeNull());
    fireEvent.click(screen.getByRole('link', { name: 'Gone' }));
    await waitFor(() => expect(container.querySelector('.ws-notice')).toHaveTextContent('“Gone.md” isn’t in this project.'));
    fireEvent.click(screen.getByRole('link', { name: 'Go' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Other page' })).toBeInTheDocument();
  });

  it('inserts an image from the tree at the editor cursor', async () => {
    const project = await createProject('OS');
    await addImage(project.id, null, pngBytes('a.png'));
    const doc = await createDocument(project.id, null, 'Intro');
    await saveDocumentContent(doc.id, 'Text');
    const user = userEvent.setup();
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByText('Text', { selector: '.md-prose p' });
    await user.click(await screen.findByRole('button', { name: 'Actions for a.png' }));
    await user.click(screen.getByRole('menuitem', { name: 'Insert in document' }));
    await waitFor(() => expect(editorText(container)).toContain('![a](a.png)'));
  });

  it('never renders unsafe HTML from a document', async () => {
    const { project, doc } = await projectWithDocument('<img src="x" onerror="window.__pwned = true">');
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await waitFor(() => expect(container.querySelector('.md-prose img')).not.toBeNull());
    expect(container.querySelector('.md-prose img')?.getAttribute('onerror')).toBeNull();
  });
});
