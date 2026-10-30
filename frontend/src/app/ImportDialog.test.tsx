import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RENDERING } from '../settings';
import { clearDatabase, getSetting, listDocuments, listProjectSummaries, setSetting, SETTINGS } from '../store';
import { ImportDialog } from './ImportDialog';

const settingsWrite = vi.hoisted(() => ({ fails: false }));
vi.mock('../store', async (importOriginal) => {
  const store = await importOriginal<typeof import('../store')>();
  return {
    ...store,
    setSetting: <T,>(key: string, value: T) => (settingsWrite.fails ? Promise.reject(new Error('quota')) : store.setSetting(key, value)),
  };
});

beforeEach(async () => {
  settingsWrite.fails = false;
  await clearDatabase();
});

const zipFile = (files: Record<string, string>, name = 'Notes.zip') =>
  new File([new Uint8Array(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))))], name, { type: 'application/zip' });

const manifest = (padding: number) =>
  JSON.stringify({ format: 'mdit-project', version: 1, name: 'Notes', description: '', exportedAt: '', rendering: { ...DEFAULT_RENDERING, padding } });

describe('ImportDialog', () => {
  it('summarises the zip, lists what was skipped and imports on request', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    const files: Record<string, string> = { 'Notes/mdit.json': manifest(16), 'Notes/a.md': '# A' };
    for (let n = 1; n <= 7; n++) files[`Notes/junk${n}.txt`] = 'x';
    render(<ImportDialog file={zipFile(files)} onClose={vi.fn()} onImported={onImported} />);
    expect(await screen.findByRole('dialog', { name: 'Import “Notes”' })).toBeInTheDocument();
    expect(screen.getByText('1 document, 0 images, 0 folders')).toBeInTheDocument();
    expect(screen.getByText('7 files weren’t imported:')).toBeInTheDocument();
    expect(screen.getByText('Notes/junk1.txt — Not a Markdown document or image')).toBeInTheDocument();
    expect(screen.getByText('and 2 more')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Use its rendering settings' }));
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    const [project] = await listProjectSummaries();
    expect(onImported).toHaveBeenCalledWith(project!.id, undefined);
    expect((await listDocuments(project!.id)).map((d) => d.title)).toEqual(['a.md']);
    expect(await getSetting(SETTINGS.rendering, null)).toMatchObject({ padding: 16 });
  });

  it('leaves the settings alone unless asked, and hides the choice when they match', async () => {
    const user = userEvent.setup();
    await setSetting(SETTINGS.rendering, { ...DEFAULT_RENDERING, padding: 16 });
    render(<ImportDialog file={zipFile({ 'mdit.json': manifest(16), 'a.md': 'x' })} onClose={vi.fn()} onImported={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Import “Notes”' });
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await vi.waitFor(async () => expect(await listProjectSummaries()).toHaveLength(1));
    expect(await getSetting(SETTINGS.rendering, null)).toMatchObject({ padding: 16 });
  });

  it('finishes the import when its settings can’t be stored, so a retry can’t duplicate the project', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    render(<ImportDialog file={zipFile({ 'mdit.json': manifest(16), 'a.md': 'x' })} onClose={vi.fn()} onImported={onImported} />);
    await screen.findByRole('dialog', { name: 'Import “Notes”' });
    await user.click(screen.getByRole('checkbox', { name: 'Use its rendering settings' }));
    settingsWrite.fails = true;
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    const projects = await listProjectSummaries();
    expect(projects).toHaveLength(1);
    expect(onImported).toHaveBeenCalledWith(projects[0]!.id, 'Imported the project, but its rendering settings couldn’t be applied.');
  });

  it('explains a file that isn’t a zip', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ImportDialog file={new File(['hello'], 'notes.txt')} onClose={onClose} onImported={vi.fn()} />);
    expect(await screen.findByRole('dialog', { name: 'Couldn’t import notes.txt' })).toBeInTheDocument();
    expect(screen.getByText('This file isn’t a zip.')).toBeInTheDocument();
    // Two buttons are named "Close": the header's IconButton and the action; the action comes last.
    await user.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(onClose).toHaveBeenCalled();
  });
});
