import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth';
import type { EditorHandle } from '../editor';
import { exportDocument, exportProject } from '../export';
import { analyze, render } from '../renderer';
import { SEARCH_INPUT_ID, SearchBox, SearchResults, type SearchMatch } from '../search';
import { toCssVars, useRenderingSettings } from '../settings';
import { IMAGE_ACCEPT, SETTINGS, useDocuments, useProject, useSettingState, type ImageAsset } from '../store';
import { FileTree } from '../tree';
import { Button, IconButton, SaveStatus, SegmentedControl, Wordmark, type SegmentedOption } from '../ui';
import { AccountMenu } from './AccountMenu';
import { ConflictDialog } from './ConflictDialog';
import { DocumentArea } from './DocumentArea';
import { ExportMenu, type ExportKind } from './ExportMenu';
import { addImagesNextTo, imageMarkdown } from './imageInsert';
import { MissingPage } from './MissingPage';
import { Notice, type NoticeMessage } from './Notice';
import { SidePanel, type PanelTab } from './SidePanel';
import { useResolvedTheme } from './theme';
import { SaveVersionDialog } from './SaveVersionDialog';
import { ThemeMenu } from './ThemeMenu';
import { useDocumentDraft } from './useDocumentDraft';
import { useProjectFiles } from './useProjectFiles';
import { useVersionActions } from './useVersionActions';

export type ViewMode = 'split' | 'editor' | 'preview';

const VIEW_OPTIONS: ReadonlyArray<SegmentedOption<ViewMode>> = [
  { value: 'split', label: 'Split', icon: 'columns' },
  { value: 'editor', label: 'Editor', icon: 'pencil' },
  { value: 'preview', label: 'Preview', icon: 'eye' },
];

export function Workspace() {
  const { projectId = '', docId } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const [mode, setMode] = useSettingState<ViewMode>(SETTINGS.mode, 'split');
  const [panelOpen, setPanelOpen] = useSettingState<boolean>(SETTINGS.panel, false);
  const [panelTab, setPanelTab] = useSettingState<PanelTab>(SETTINGS.panelTab, 'outline');
  const draft = useDocumentDraft(docId);
  const theme = useResolvedTheme();
  const [rendering, updateRendering, resetRendering] = useRenderingSettings();
  const proseStyle = useMemo(() => toCssVars(rendering) as CSSProperties, [rendering]);
  const { saveNow } = draft;
  const files = useProjectFiles(projectId, docId);
  const { index, docFolderId, imageUrls } = files;
  const html = useMemo(() => render(draft.previewSource, files.context), [draft.previewSource, files.context]);
  const editorRef = useRef<EditorHandle>(null);
  const mainRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docReady = draft.status === 'ready';
  const analysis = useMemo(
    () => (panelOpen && panelTab !== 'settings' && docReady ? analyze(draft.previewSource) : null),
    [panelOpen, panelTab, docReady, draft.previewSource],
  );
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const [revealId, setRevealId] = useState<string | null>(null);
  const [pendingSelect, setPendingSelect] = useState<({ docId: string } & SearchMatch) | null>(null);
  const auth = useAuth();
  const docRow = useDocuments(projectId)?.find((d) => d.id === docId);
  const canSaveVersion = auth.state === 'signed-in' && docReady;
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  // Ctrl/Cmd+S saves now (never the browser's "Save page"); Ctrl/Cmd+Shift+S saves a version;
  // Ctrl/Cmd+Shift+F focuses project search.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 's' && event.shiftKey) {
        event.preventDefault();
        if (canSaveVersion) setSaveDialogOpen(true);
      } else if (key === 's') {
        event.preventDefault();
        saveNow();
      } else if (key === 'f' && event.shiftKey) {
        event.preventDefault();
        document.getElementById(SEARCH_INPUT_ID)?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow, canSaveVersion]);

  const openDocument = useCallback((id: string) => navigate(`/p/${projectId}/d/${id}`), [navigate, projectId]);
  const closeDocument = useCallback(() => navigate(`/p/${projectId}`, { replace: true }), [navigate, projectId]);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const showNotice = useCallback((text: string) => setNotice({ id: Date.now() + Math.random(), text }), []);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const currentText = useCallback(() => editorRef.current?.getText() ?? draft.previewSource, [draft.previewSource]);
  const versions = useVersionActions({ docId, draft, currentText, notify: showNotice, openDocument });
  const versionSaved = draft.saveState === 'saved' && docRow !== undefined && !docRow.dirty && docRow.headVersionId !== undefined;

  const insertFiles = useCallback(
    async (list: File[], at: number | null) => {
      if (list.length === 0) return;
      const { markdown, errors } = await addImagesNextTo(projectId, docFolderId, list);
      if (markdown) editorRef.current?.insertBlock(markdown, at);
      if (errors.length > 0) showNotice(errors.join(' '));
    },
    [projectId, docFolderId, showNotice],
  );

  const insertImage = useCallback(
    (image: ImageAsset) => {
      const href = index.relativeHref(docFolderId, { kind: 'image', id: image.id });
      if (href) editorRef.current?.insertBlock(imageMarkdown(image.name, href));
    },
    [index, docFolderId],
  );

  // Outline clicks scroll whichever panes are visible to the heading.
  const revealHeading = useCallback(
    (line: number) => {
      if (mode !== 'editor') mainRef.current?.querySelector<HTMLElement>(`.ws-preview [data-line="${line}"]`)?.scrollIntoView({ block: 'start' });
      if (mode !== 'preview') editorRef.current?.revealLine(line);
    },
    [mode],
  );

  const openFromSearch = useCallback(
    (id: string, match?: SearchMatch) => {
      if (match) {
        setPendingSelect({ docId: id, ...match });
        if (mode === 'preview') setMode('split'); // the match is selected in the editor, so show it
      }
      openDocument(id);
    },
    [mode, setMode, openDocument],
  );
  const revealFromSearch = useCallback((id: string) => {
    setQuery('');
    setRevealId(id);
  }, []);
  const clearReveal = useCallback(() => setRevealId(null), []);

  const runExport = useCallback(
    async (kind: ExportKind) => {
      try {
        saveNow();
        // The editor's text, not the debounced preview or the last autosave: exports include the last keystroke.
        const text = editorRef.current?.getText() ?? draft.previewSource;
        if (kind === 'zip') {
          await exportProject(projectId, undefined, docId && docReady ? { docId, text } : undefined);
          return;
        }
        if (!docId) return;
        await exportDocument(kind, { projectId, docId, text, rendering });
      } catch (error) {
        showNotice(`Couldn’t export: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [projectId, docId, docReady, saveNow, draft.previewSource, rendering, showNotice],
  );

  // Select a search match once its document's editor is mounted.
  useEffect(() => {
    if (!pendingSelect || pendingSelect.docId !== docId || !docReady) return;
    editorRef.current?.select(pendingSelect.from, pendingSelect.to);
    setPendingSelect(null);
  }, [pendingSelect, docId, docReady]);

  if (project === undefined) return <div className="ws" aria-busy="true" />;
  if (project === null) {
    return <MissingPage title="This project isn’t in this browser" text="It may have been deleted, or it was created in another browser." />;
  }

  return (
    <div className="ws">
      <header className="app-toolbar ws-toolbar">
        <div className="ws-left">
          <Link to="/" className="home-link" aria-label="All projects">
            <Wordmark />
          </Link>
          <span className="ws-crumb-sep" aria-hidden="true">
            /
          </span>
          <span className="ws-project" title={project.name}>
            {project.name}
          </span>
        </div>
        <SegmentedControl label="View" value={mode} onChange={setMode} options={VIEW_OPTIONS} />
        <div className="ws-right">
          <IconButton icon="image" label="Insert image" disabled={!docReady} onClick={() => fileInputRef.current?.click()} />
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            hidden
            tabIndex={-1}
            onChange={(event) => {
              const list = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              void insertFiles(list, null);
            }}
          />
          <ExportMenu canExportDocument={docReady} onExport={(kind) => void runExport(kind)} />
          {draft.status === 'ready' &&
            (versionSaved ? (
              <SaveStatus state="cloud" detail={versions.lastNumber !== null ? `v${versions.lastNumber}` : undefined} />
            ) : (
              <SaveStatus state={draft.saveState} detail={draft.saveState === 'failed' ? 'your last changes are only in this tab' : undefined} />
            ))}
          {canSaveVersion && (
            <Button icon="cloud" onClick={() => setSaveDialogOpen(true)}>
              Save version
            </Button>
          )}
          <AccountMenu
            onBeforeLeave={draft.flush}
            onAccountDeleted={() => showNotice('Your account was deleted. Your projects are still in this browser.')}
          />
          <IconButton icon="sidebar" label={panelOpen ? 'Hide panel' : 'Show panel'} active={panelOpen} onClick={() => setPanelOpen(!panelOpen)} />
          <ThemeMenu />
        </div>
      </header>
      <div className="ws-body">
        <aside className="ws-tree" aria-label="Project files">
          <SearchBox value={query} onChange={setQuery} />
          {searching && <SearchResults projectId={projectId} query={query} onOpenDocument={openFromSearch} onReveal={revealFromSearch} />}
          <div className="ws-tree-files" hidden={searching}>
            <FileTree
              projectId={projectId}
              activeDocId={docId}
              onOpen={openDocument}
              onActiveDeleted={closeDocument}
              onInsertImage={docReady ? insertImage : undefined}
              imageUrls={imageUrls}
              revealId={revealId}
              onRevealed={clearReveal}
            />
          </div>
        </aside>
        <main ref={mainRef} className={`ws-main mode-${mode}`}>
          <DocumentArea
            docId={docId}
            draft={draft}
            html={html}
            theme={theme}
            proseStyle={proseStyle}
            editorRef={editorRef}
            onImageFiles={(list, at) => void insertFiles(list, at)}
            onOpenDocument={openDocument}
            onNotice={showNotice}
          />
          <Notice notice={notice} onDismiss={dismissNotice} />
        </main>
        {panelOpen && (
          <SidePanel
            tab={panelTab}
            onTab={setPanelTab}
            analysis={analysis}
            onHeading={revealHeading}
            rendering={rendering}
            onRenderingChange={updateRendering}
            onRenderingReset={resetRendering}
          />
        )}
      </div>
      {saveDialogOpen && <SaveVersionDialog onSave={versions.save} onClose={() => setSaveDialogOpen(false)} />}
      {versions.conflict && (
        <ConflictDialog
          latestNumber={versions.conflict.latest.number}
          onLoadLatest={versions.loadLatest}
          onSaveCopy={versions.saveCopy}
          onClose={versions.dismissConflict}
        />
      )}
    </div>
  );
}
