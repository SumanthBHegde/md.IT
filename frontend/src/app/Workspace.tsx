import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { VersionSummary } from '../api';
import { useAuth } from '../auth';
import { withKey, type EditorHandle } from '../editor';
import { exportDocument, exportProject } from '../export';
import { analyze, render } from '../renderer';
import { SEARCH_INPUT_ID, SearchBox, SearchResults, type SearchMatch } from '../search';
import { toCssVars, useRenderingSettings } from '../settings';
import { createDocument, IMAGE_ACCEPT, SETTINGS, useDocuments, useProject, userMessage, useSettingState, type ImageAsset } from '../store';
import { readVersion } from '../sync';
import { FileTree } from '../tree';
import { Button, IconButton, SaveStatus, SegmentedControl, Wordmark, type SegmentedOption } from '../ui';
import { AccountMenu } from './AccountMenu';
import { ConflictDialog } from './ConflictDialog';
import { DocumentArea } from './DocumentArea';
import { ExportMenu, type ExportKind } from './ExportMenu';
import { HistoryPanel } from './HistoryPanel';
import { addImagesNextTo, imageMarkdown } from './imageInsert';
import { MissingPage } from './MissingPage';
import { Notice, type NoticeMessage } from './Notice';
import { SidePanel, type PanelTab } from './SidePanel';
import { useResolvedTheme } from './theme';
import { SaveVersionDialog } from './SaveVersionDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ThemeMenu } from './ThemeMenu';
import { TreeResizer, useTreeWidth } from './TreeResizer';
import { useDocumentDraft } from './useDocumentDraft';
import { useProjectFiles } from './useProjectFiles';
import { useVersionActions } from './useVersionActions';
import { VersionViewer } from './VersionViewer';

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
  const [treeOpen, setTreeOpen] = useSettingState<boolean>(SETTINGS.tree, true);
  const treeWidth = useTreeWidth();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
    () => ((panelTab === 'outline' || panelTab === 'stats') && panelOpen && docReady ? analyze(draft.previewSource) : null),
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

  // Search lives in the tree, so a hidden tree opens first and search takes the focus once it shows.
  const focusSearchOnOpen = useRef(false);
  useEffect(() => {
    if (!treeOpen || !focusSearchOnOpen.current) return;
    focusSearchOnOpen.current = false;
    document.getElementById(SEARCH_INPUT_ID)?.focus();
  }, [treeOpen]);

  // Ctrl/Cmd+S saves now (never the browser's "Save page"); Ctrl/Cmd+Shift+S saves a version;
  // Ctrl/Cmd+Shift+F focuses project search; Ctrl/Cmd+\ shows or hides the tree; F1 lists all of these.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
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
        if (treeOpen) {
          document.getElementById(SEARCH_INPUT_ID)?.focus();
        } else {
          focusSearchOnOpen.current = true;
          setTreeOpen(true);
        }
      } else if (key === '\\') {
        event.preventDefault();
        setTreeOpen(!treeOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow, canSaveVersion, treeOpen, setTreeOpen]);

  const openDocument = useCallback((id: string) => navigate(`/p/${projectId}/d/${id}`), [navigate, projectId]);
  const closeDocument = useCallback(() => navigate(`/p/${projectId}`, { replace: true }), [navigate, projectId]);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const showNotice = useCallback((text: string) => setNotice({ id: Date.now() + Math.random(), text }), []);
  const dismissNotice = useCallback(() => setNotice(null), []);
  // A page that sent us here may hand over a notice (the project list after a download).
  const location = useLocation();
  const arrivalNotice = (location.state as { notice?: unknown } | null)?.notice;
  useEffect(() => {
    if (typeof arrivalNotice === 'string') showNotice(arrivalNotice);
  }, [arrivalNotice, showNotice]);
  const currentText = useCallback(() => editorRef.current?.getText() ?? draft.previewSource, [draft.previewSource]);
  const versions = useVersionActions({ docId, draft, currentText, notify: showNotice, openDocument });
  const versionSaved = draft.saveState === 'saved' && docRow !== undefined && !docRow.dirty && docRow.headVersionId !== undefined;
  const [viewing, setViewing] = useState<{ version: VersionSummary; text: string } | null>(null);
  const viewerHtml = useMemo(() => (viewing ? render(viewing.text, files.context) : ''), [viewing, files.context]);
  useEffect(() => setViewing(null), [docId]);
  // The editor was unmounted while the viewer showed; it must come back with the stored text,
  // not the text it was first loaded with (edits since then would vanish, then be overwritten).
  const { reload: reloadDraft, flush: flushDraft } = draft;
  const closeViewer = useCallback(async () => {
    try {
      await flushDraft(); // an edit typed while the version was opening
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Your last changes couldn’t be saved in this browser.');
      return;
    }
    setViewing(null);
    reloadDraft();
  }, [flushDraft, reloadDraft, showNotice]);
  const openVersion = useCallback(
    async (version: VersionSummary) => {
      try {
        await draft.flush();
        const { text } = await readVersion(version.id);
        setViewing({ version, text });
      } catch (error) {
        showNotice(`Couldn’t open version ${version.number}: ${error instanceof Error ? error.message.replace(/[.\s]+$/, '') : 'something went wrong'}.`);
      }
    },
    [draft, showNotice],
  );

  const newDocument = useCallback(async () => {
    try {
      openDocument((await createDocument(projectId, null)).id);
    } catch (error) {
      showNotice(userMessage(error));
    }
  }, [projectId, openDocument, showNotice]);

  const insertFiles = useCallback(
    async (list: File[], at: number | null) => {
      if (list.length === 0) return;
      // The editor remounts per document and per restore, so a new handle means the text changed under us.
      const editor = editorRef.current;
      const { markdown, errors } = await addImagesNextTo(projectId, docFolderId, list);
      if (markdown && editor && editor === editorRef.current) editor.insertBlock(markdown, at);
      else if (markdown) errors.push('Added to the project, but it wasn’t inserted because the open document changed.');
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
          <IconButton
            icon="sidebar"
            label={withKey(treeOpen ? 'Hide file tree' : 'Show file tree', 'Mod-\\')}
            active={treeOpen}
            onClick={() => setTreeOpen(!treeOpen)}
          />
          <Link to="/" className="home-link" aria-label="All projects">
            <Wordmark />
          </Link>
          <span className="ws-crumb-sep" aria-hidden="true">
            /
          </span>
          <span className="ws-project" title={project.name}>
            {project.name}
          </span>
          {docRow && (
            <>
              <span className="ws-crumb-sep" aria-hidden="true">
                /
              </span>
              <span className="ws-document" title={docRow.title}>
                {docRow.title}
              </span>
            </>
          )}
        </div>
        <SegmentedControl label="View" value={mode} onChange={setMode} options={VIEW_OPTIONS} />
        <div className="ws-right">
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
          <IconButton icon="panel-right" label={panelOpen ? 'Hide panel' : 'Show panel'} active={panelOpen} onClick={() => setPanelOpen(!panelOpen)} />
          <IconButton icon="keyboard" label="Keyboard shortcuts (F1)" onClick={() => setShortcutsOpen(true)} />
          <ThemeMenu />
        </div>
      </header>
      <div className="ws-body">
        <aside className="ws-tree" aria-label="Project files" hidden={!treeOpen} style={{ '--sidebar-width': `${treeWidth.width}px` } as CSSProperties}>
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
        {treeOpen && <TreeResizer width={treeWidth.width} onResize={treeWidth.preview} onResizeEnd={treeWidth.commit} />}
        <main ref={mainRef} className={`ws-main mode-${mode}`}>
          <DocumentArea
            docId={docId}
            draft={draft}
            html={html}
            theme={theme}
            proseStyle={proseStyle}
            editorRef={editorRef}
            onImageFiles={(list, at) => void insertFiles(list, at)}
            onInsertImage={() => fileInputRef.current?.click()}
            onNewDocument={() => void newDocument()}
            onOpenDocument={openDocument}
            onNotice={showNotice}
            viewer={
              viewing && (
                <VersionViewer
                  version={viewing.version}
                  html={viewerHtml}
                  theme={theme}
                  proseStyle={proseStyle}
                  dirty={docRow?.dirty !== false}
                  onNotice={showNotice}
                  onClose={() => void closeViewer()}
                  onRestore={async () => {
                    if (await versions.restore(viewing.version.id, viewing.version.number)) setViewing(null);
                  }}
                  onDelete={async () => {
                    if (await versions.remove(viewing.version.id)) await closeViewer();
                  }}
                />
              )
            }
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
            history={
              <HistoryPanel
                docId={docId}
                headVersionId={docRow?.headVersionId}
                signedIn={auth.state === 'signed-in'}
                refreshKey={versions.refreshKey}
                onOpen={(version) => void openVersion(version)}
              />
            }
          />
        )}
      </div>
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
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
