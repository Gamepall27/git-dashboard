import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, FolderOpen, GitBranch, LayoutGrid, Monitor, Moon, Plus, RefreshCw, Sun, X } from 'lucide-react';
import { defaultSettings, type Commit, type ModuleConfig, type RepoSnapshot, type Settings, type Workspace } from '../shared/types';
import { api, fullDate, unwrap } from './lib';
import { Sidebar } from './components/Sidebar';
import { Overview } from './components/Overview';
import { RepositoryView } from './components/RepositoryView';
import { CommitDetail } from './components/CommitDetail';
import { ErrorMessage, IconButton, Modal } from './components/UI';

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>({ repositories: [], settings: defaultSettings() });
  const [snapshots, setSnapshots] = useState<RepoSnapshot[]>([]);
  const [active, setActive] = useState('home'); const [tabs, setTabs] = useState<string[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false); const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(''); const [dialog, setDialog] = useState<'add' | 'settings' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null); const [removeBusy, setRemoveBusy] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<{ id: string; commit: Commit } | null>(null);
  const refreshBusy = useRef(false); const refreshPending = useRef(false); const mounted = useRef(true);
  const lastRefresh = useRef(0);
  const refresh = useCallback(async function runRefresh(): Promise<void> {
    if (!window.gitDashboard) return;
    if (refreshBusy.current) { refreshPending.current = true; return; }
    refreshBusy.current = true; setRefreshing(true);
    try {
      const data = unwrap(await api().snapshots());
      if (mounted.current) { setSnapshots(data); setRevision(r => r + 1); setUpdatedAt(new Date().toISOString()); lastRefresh.current = Date.now(); }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { refreshBusy.current = false; if (mounted.current) setRefreshing(false); if (refreshPending.current && mounted.current) { refreshPending.current = false; void runRefresh(); } }
  }, []);
  useEffect(() => {
    mounted.current = true; let cancelled = false;
    async function init() {
      try { const data = unwrap(await api().loadWorkspace()); if (!cancelled) { setWorkspace(data); await refresh(); } }
      catch (e) { if (!cancelled) setError((e as Error).message); }
      finally { if (!cancelled) setInitializing(false); }
    }
    void init();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60_000);
    const focus = () => { if (Date.now() - lastRefresh.current > 15_000) void refresh(); };
    window.addEventListener('focus', focus);
    return () => { cancelled = true; mounted.current = false; clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [refresh]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = workspace.settings.theme === 'system' ? media.matches ? 'dark' : 'light' : workspace.settings.theme; };
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [workspace.settings.theme]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || document.querySelector('dialog[open]')) return;
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); setDialog('add'); }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); void refresh(); }
      if (event.key === '1') { event.preventDefault(); setActive('home'); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [refresh]);
  function openRepo(id: string, branch?: string) {
    setTabs(t => t.includes(id) ? t : [...t, id]); setActive(id);
    if (branch) setBranches(b => ({ ...b, [id]: branch }));
  }
  function closeTab(id: string) {
    const next = tabs.filter(tab => tab !== id); setTabs(next);
    if (active === id) setActive(next[next.length - 1] ?? 'home');
  }
  function showCommit(id: string, commit: Commit) { setSelectedCommit({ id, commit }); }
  async function saveSettings(settings: Settings): Promise<boolean> {
    try { const saved = unwrap(await api().saveSettings(settings)); setWorkspace(w => ({ ...w, settings: saved })); return true; }
    catch (e) { setError((e as Error).message); return false; }
  }
  async function saveModules(configs: ModuleConfig[]): Promise<boolean> {
    const settings = active === 'home' ? { ...workspace.settings, modules: configs } : { ...workspace.settings, repoModules: { ...workspace.settings.repoModules, [active]: configs } };
    return saveSettings(settings);
  }
  async function removeRepo() {
    if (!removing) return; const id = removing; setRemoveBusy(true);
    try {
      const data = unwrap(await api().removeRepository(id)); setWorkspace(data); closeTab(id);
      setSnapshots(s => s.filter(r => r.repository.id !== id)); setRemoving(null); void refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setRemoveBusy(false); }
  }
  const repository = workspace.repositories.find(r => r.id === active);
  const selectedRepository = workspace.repositories.find(r => r.id === selectedCommit?.id);
  const errors = snapshots.filter(s => s.error).length;
  return <div className="app-shell">
    <Sidebar repositories={workspace.repositories} snapshots={snapshots} active={active} onHome={() => setActive('home')} onOpen={openRepo} onAdd={() => setDialog('add')} onRemove={setRemoving} onSettings={() => setDialog('settings')} />
    <div className="main-shell"><div className="tabbar"><div className="tabs" role="tablist" aria-label="Geöffnete Ansichten"><button role="tab" id="tab-home" aria-controls="main-content" aria-selected={active === 'home'} className={`tab ${active === 'home' ? 'active' : ''}`} onClick={() => setActive('home')}><LayoutGrid size={14} />Übersicht</button>{tabs.map(id => {
      const repo = workspace.repositories.find(r => r.id === id); if (!repo) return null;
      return <div className={`repo-tab ${active === id ? 'active' : ''}`} key={id}><button role="tab" id={`tab-${id}`} aria-controls="main-content" aria-selected={active === id} className="tab" onClick={() => setActive(id)} title={repo.path}><GitBranch size={13} /><span>{repo.name}</span></button><IconButton label={`Tab ${repo.name} schließen`} onClick={() => closeTab(id)}><X size={12} /></IconButton></div>;
    })}</div><div className="tabbar-actions"><IconButton label="Repository öffnen" onClick={() => setDialog('add')}><Plus size={16} /></IconButton><IconButton label="Alle Repositories aktualisieren" disabled={refreshing || initializing || !window.gitDashboard} onClick={() => { setError(''); void refresh(); }}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /></IconButton></div></div>
      <main className="main-content" id="main-content" role="tabpanel" aria-labelledby={`tab-${active}`}>
        {error && <div className="global-error"><ErrorMessage message={error} /><IconButton label="Fehlerhinweis schließen" onClick={() => setError('')}><X size={15} /></IconButton></div>}
        {active === 'home' || !repository ? <Overview snapshots={snapshots} repositories={workspace.repositories} loading={refreshing || initializing} onAdd={() => setDialog('add')} onOpen={openRepo} onCommit={showCommit} configs={workspace.settings.modules} onModulesChange={saveModules} /> : <RepositoryView key={repository.id} repository={repository} snapshot={snapshots.find(s => s.repository.id === active)} snapshots={snapshots} repositories={workspace.repositories} branch={branches[active] ?? 'HEAD'} onBranch={branch => setBranches(b => ({ ...b, [active]: branch }))} onCommit={commit => showCommit(active, commit)} configs={workspace.settings.repoModules[active]} onModulesChange={saveModules} onError={setError} revision={revision} />}
      </main><footer className="statusbar"><span><span className={`local-dot ${errors ? 'warning-dot' : ''}`} />{refreshing ? 'Git-Daten werden gelesen …' : errors ? `${errors} Repository nicht verfügbar` : 'Lokaler Workspace'}<span className="status-separator">·</span>{workspace.repositories.length} Repositories</span><span title={updatedAt ? fullDate(updatedAt) : undefined}>{updatedAt ? `Aktualisiert um ${new Date(updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'Bereit'}<span className="status-separator">·</span>Automatisch alle 60 s</span></footer>
    </div>
    {dialog === 'add' && <AddRepositories onClose={() => setDialog(null)} onAdded={data => { setWorkspace(data); setDialog(null); setError(''); void refresh(); }} />}
    {dialog === 'settings' && <SettingsDialog settings={workspace.settings} onClose={() => setDialog(null)} onSave={saveSettings} />}
    {removing && <Modal title="Repository aus Workspace entfernen" onClose={() => { if (!removeBusy) setRemoving(null); }}><div className="modal-body"><p><strong>{workspace.repositories.find(r => r.id === removing)?.name}</strong> aus diesem Workspace entfernen?</p><p className="muted">Der Ordner und seine Git-Daten bleiben erhalten. Module, die ausschließlich dieses Repository auswerten, werden ebenfalls entfernt.</p></div><footer className="modal-footer"><button className="button secondary" disabled={removeBusy} onClick={() => setRemoving(null)}>Abbrechen</button><button className="button danger-button" disabled={removeBusy} onClick={() => void removeRepo()}>{removeBusy ? 'Entfernen …' : 'Aus Workspace entfernen'}</button></footer></Modal>}
    {selectedCommit && selectedRepository && <CommitDetail repository={selectedRepository} commit={selectedCommit.commit} onClose={() => setSelectedCommit(null)} />}
  </div>;
}

function AddRepositories({ onClose, onAdded }: { onClose: () => void; onAdded: (workspace: Workspace) => void }) {
  const [paths, setPaths] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const add = async (explicit?: string[]) => {
    setBusy(true); setError('');
    try { const data = unwrap(await api().addRepositories(explicit)); onAdded(data); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal title="Repositories öffnen" onClose={() => { if (!busy) onClose(); }}><div className="modal-body"><p className="muted">Wähle lokale Ordner mit einem Git-Repository. Bereits geöffnete Repositories werden erkannt.</p><button className="button secondary browse-button" disabled={busy} onClick={() => void add()}><FolderOpen size={18} />{busy ? 'Öffnen …' : 'Ordner auswählen …'}</button><div className="form-divider"><span>oder Pfade eingeben</span></div><form id="add-repositories" onSubmit={event => { event.preventDefault(); void add(paths.split('\n').map(p => p.trim()).filter(Boolean)); }}><label className="form-field">Repository-Pfade<textarea aria-label="Repository-Pfade" value={paths} rows={4} placeholder={window.gitDashboard?.platform === 'win32' ? 'C:\\Projekte\\mein-repository' : '/home/name/projekte/mein-repository'} disabled={busy} onChange={e => setPaths(e.target.value)} /></label><span className="form-help">Ein Pfad pro Zeile. Ein Unterordner des Repositories funktioniert ebenfalls.</span></form>{error && <ErrorMessage message={error} />}</div><footer className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>Abbrechen</button><button className="button primary" form="add-repositories" type="submit" disabled={busy || !paths.trim()}>{busy ? 'Öffnen …' : 'Repositories öffnen'}</button></footer></Modal>;
}
function SettingsDialog({ settings, onClose, onSave }: { settings: Settings; onClose: () => void; onSave: (settings: Settings) => Promise<boolean> }) {
  const [theme, setTheme] = useState(settings.theme); const [busy, setBusy] = useState(false);
  return <Modal title="Einstellungen" onClose={() => { if (!busy) onClose(); }}><form onSubmit={async e => { e.preventDefault(); setBusy(true); if (await onSave({ ...settings, theme })) onClose(); setBusy(false); }}><div className="modal-body"><label className="form-label">Darstellung</label><div className="theme-options">{([{ value: 'dark', label: 'Dunkel', icon: Moon }, { value: 'light', label: 'Hell', icon: Sun }, { value: 'system', label: 'System', icon: Monitor }] as const).map(t => <button type="button" key={t.value} className={`theme-option ${theme === t.value ? 'selected' : ''}`} aria-pressed={theme === t.value} disabled={busy} onClick={() => setTheme(t.value)}><t.icon size={21} />{t.label}{theme === t.value && <Check size={13} />}</button>)}</div><div className="settings-info"><h3>Dein lokaler Workspace</h3><p>Geöffnete Repositories und Module werden automatisch gespeichert. Git-Daten werden beim Start, bei Rückkehr zur App und alle 60 Sekunden aktualisiert.</p><h3>Tastatur</h3><div><span>Repository öffnen</span><kbd>Ctrl / ⌘ O</kbd></div><div><span>Aktualisieren</span><kbd>Ctrl / ⌘ R</kbd></div><div><span>Zur Übersicht</span><kbd>Ctrl / ⌘ 1</kbd></div><div><span>Dialog schließen</span><kbd>Esc</kbd></div><h3>Statistiken verstehen</h3><p>Alle erreichbaren lokalen und Remote-Branches sowie Tags werden berücksichtigt. Jeder Commit zählt innerhalb eines Repositories einmal. Merge-Commits sind ausgenommen; Zeilen bedeuten hinzugefügte und entfernte Zeilen, einschließlich später wieder geänderter Zeilen. Personen werden nach der von Git aufgelösten E-Mail-Adresse zusammengefasst (.mailmap wird berücksichtigt).</p></div></div><footer className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Abbrechen</button><button className="button primary" disabled={busy}>{busy ? 'Speichern …' : 'Speichern'}</button></footer></form></Modal>;
}
