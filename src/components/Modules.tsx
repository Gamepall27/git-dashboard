import { useMemo, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, BarChart3, CalendarDays, CalendarRange, Check, Flame, FolderGit2, Plus, SlidersHorizontal, UsersRound, X } from 'lucide-react';
import { defaultModules, MODULE_TYPES, PERIODS, type ModuleConfig, type ModuleType, type Repository, type RepoSnapshot } from '../../shared/types';
import { authorStats, dailyStats, hotspotStats, repositoryStats, scopedCommits, weekdayStats } from '../../shared/statistics';
import { number, shortDate } from '../lib';
import { EmptyState, IconButton, Modal } from './UI';

const icons: Record<ModuleType, typeof Activity> = { authors: UsersRound, repositories: FolderGit2, timeline: Activity, heatmap: CalendarDays, hotspots: Flame, weekdays: CalendarRange, workingTree: BarChart3 };
function ScopeLabel({ config, repos }: { config: ModuleConfig; repos: Repository[] }) {
  const names = config.repoIds.map(id => repos.find(r => r.id === id)?.name).filter(Boolean);
  return <span className="module-scope" title={names.join(', ')}>{config.repoIds.length ? names.length === 1 ? names[0] : `${names.length} Repositories` : 'Alle Repositories'}<span>·</span>{PERIODS.find(p => p.value === config.period)?.label}</span>;
}
function ModuleContent({ config, snapshots }: { config: ModuleConfig; snapshots: RepoSnapshot[] }) {
  const commits = useMemo(() => scopedCommits(snapshots, config), [snapshots, config]);
  if (config.type === 'workingTree') {
    const repos = snapshots.filter(s => !config.repoIds.length || config.repoIds.includes(s.repository.id));
    return <div className="working-module">{repos.length ? repos.map(s => <div className="working-repo" key={s.repository.id}><FolderGit2 size={15} /><span>{s.repository.name}</span>{s.error ? <span className="negative">Nicht verfügbar</span> : s.workingFiles.length ? <span className="working-count">{s.workingFiles.length} geändert</span> : <span className="positive"><Check size={12} />Sauber</span>}</div>) : <ModuleEmpty />}</div>;
  }
  if (!commits.length && config.type !== 'heatmap') return <ModuleEmpty />;
  if (config.type === 'authors') {
    const authors = authorStats(commits); const max = Math.max(...authors.map(a => a.additions + a.deletions), 1);
    return <><div className="module-table-head"><span>Autor</span><span>Commits</span><span>Geänderte Zeilen</span></div><div className="metric-list">{authors.slice(0, 6).map((a, i) => <div className="author-row" key={a.email || a.name}><span className={`avatar avatar-${i % 4}`}>{a.name.slice(0, 2).toUpperCase()}</span><div className="author-name" title={a.email}>{a.name}<div className="line-meter"><span className="added" style={{ width: `${a.additions / max * 100}%` }} /><span className="removed" style={{ width: `${a.deletions / max * 100}%` }} /></div></div><span className="metric-number muted">{number(a.commits)}</span><span className="line-count"><span className="positive">+{number(a.additions)}</span><span className="negative">−{number(a.deletions)}</span></span></div>)}</div><div className="module-footnote">{authors.length > 6 ? `Top 6 von ${authors.length} Personen · ` : ''}Identität nach E-Mail · Änderungen, keine Produktivitätswertung</div></>;
  }
  if (config.type === 'repositories') {
    const repos = repositoryStats(commits); const max = Math.max(...repos.map(r => r.commits), 1);
    return <div className="ranking-list">{repos.slice(0, 6).map((r, i) => <div className="ranking-row" key={r.id}><span className="rank">{String(i + 1).padStart(2, '0')}</span><div className="ranking-info"><div><span>{r.name}</span><span className="muted">{number(r.commits)} Commits</span></div><div className="ranking-meter"><span style={{ width: `${r.commits / max * 100}%` }} /></div></div></div>)}<div className="module-footnote">{number(commits.length)} Commits über {repos.length} aktive Repositories</div></div>;
  }
  if (config.type === 'hotspots') {
    const files = hotspotStats(commits);
    return <div className="hotspot-list">{files.slice(0, 6).map(f => <div className="hotspot-row" key={`${f.repoName}-${f.path}`}><div title={`${f.repoName}/${f.path}`}><span className="mono">{f.path}</span><small>{f.repoName}</small></div><span>{f.commits}<small>Änderungen</small></span><span className="muted">{f.binary && !f.additions && !f.deletions ? 'Binär' : `${number(f.additions + f.deletions)} Z.`}</span></div>)}<div className="module-footnote">Dateipfade zum jeweiligen Commit · Top 6</div></div>;
  }
  if (config.type === 'weekdays') {
    const rows = weekdayStats(commits); const max = Math.max(...rows.map(r => r.count), 1);
    return <><div className="weekday-chart">{rows.map(row => <div className="weekday-column" key={row.name}><span className="muted">{number(row.count)}</span><div className="weekday-bar-track"><div style={{ height: `${Math.max(row.count ? 3 : 0, row.count / max * 100)}%` }} /></div><span>{row.name}</span></div>)}</div><div className="module-footnote">Lokale Zeitzone · {number(commits.length)} Commits</div></>;
  }
  if (config.type === 'heatmap') {
    const days = dailyStats(commits, 91); const max = Math.max(...days.map(d => d.count), 1);
    const offset = (days[0].date.getDay() + 6) % 7;
    return <><div className="heatmap-layout"><div className="heatmap-labels"><span>Mo</span><span>Mi</span><span>Fr</span><span>So</span></div><div className="heatmap-grid">{Array.from({ length: offset }, (_, i) => <span className="heatmap-blank" key={`blank-${i}`} />)}{days.map(d => <span key={d.key} aria-label={`${shortDate(d.key)}: ${d.count} Commits`} title={`${shortDate(d.key)}: ${d.count} Commits`} className={`heatmap-cell heat-${d.count === 0 ? 0 : Math.min(4, Math.ceil(d.count / max * 4))}`} />)}</div></div><div className="heatmap-legend"><span>Letzte 13 Wochen · Zeitraumfilter gilt</span><span>Wenig{[0, 1, 2, 3, 4].map(n => <i key={n} className={`heatmap-cell heat-${n}`} />)}Viel</span></div></>;
  }
  const earliest = commits.reduce((earliest, c) => Math.min(earliest, new Date(c.commit.date).getTime()), Date.now());
  const allDays = Math.ceil((Date.now() - earliest) / 86_400_000) + 1;
  const days = Math.min(config.period || allDays, 366);
  const daily = dailyStats(commits, days);
  const bucketSize = Math.max(1, Math.ceil(days / 60));
  const buckets = Array.from({ length: Math.ceil(days / bucketSize) }, (_, i) => {
    const slice = daily.slice(i * bucketSize, (i + 1) * bucketSize);
    return { count: slice.reduce((s, d) => s + d.count, 0), first: slice[0].key, last: slice[slice.length - 1].key };
  });
  const max = Math.max(...buckets.map(d => d.count), 1);
  const chartTotal = daily.reduce((s, d) => s + d.count, 0);
  return <><div className="timeline-summary"><strong>{number(chartTotal)}</strong><span>Commits in {days} Tagen</span><span className="timeline-peak">Maximum {max} / {bucketSize === 1 ? 'Tag' : `${bucketSize} Tage`}</span></div><div className="timeline-chart" role="img" aria-label={`Aktivität: ${chartTotal} Commits in ${days} Tagen`}>{buckets.map(d => <div key={d.first} title={`${shortDate(d.first)}${d.first !== d.last ? ` – ${shortDate(d.last)}` : ''}: ${d.count} Commits`} className={`timeline-bar ${d.count ? '' : 'zero'}`} style={{ height: `${Math.max(d.count ? 3 : 1, d.count / max * 100)}%` }} />)}</div><div className="chart-axis"><span>{shortDate(daily[0].key)}</span><span>{shortDate(daily[Math.floor(days / 2)].key)}</span><span>Heute</span></div>{!config.period && allDays > 366 && <div className="module-footnote">Diagramm zeigt maximal die letzten 366 Tage.</div>}</>;
}
function ModuleEmpty() { return <div className="module-empty"><Activity size={20} /><span>Keine Aktivität in dieser Auswahl.</span><small>Zeitraum oder Repositories anpassen.</small></div>; }

interface Props { configs: ModuleConfig[]; snapshots: RepoSnapshot[]; repositories: Repository[]; onChange: (configs: ModuleConfig[]) => Promise<boolean>; repoId?: string }
export function Modules({ configs, snapshots, repositories, onChange, repoId }: Props) {
  const [editing, setEditing] = useState<ModuleConfig | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const persist = async (next: ModuleConfig[]) => { setSaving(true); try { return await onChange(next); } finally { setSaving(false); } };
  const move = (index: number, direction: number) => { const next = [...configs]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; void persist(next); };
  const truncated = snapshots.some(s => s.truncated && configs.some(c => !c.repoIds.length || c.repoIds.includes(s.repository.id)));
  return <section className="modules-section">
    <div className="section-heading"><div><h2>Deine Module</h2><span className="muted">{repoId ? 'Auswertungen für dieses Repository' : 'Dein Blick auf den Workspace'}</span></div><div className="section-actions">{!configs.length && <button className="text-button" disabled={saving} onClick={() => void persist(defaultModules(repoId))}>Standardmodule laden</button>}<button className="button secondary small" disabled={saving || configs.length >= 50} onClick={() => { setError(''); setEditing('new'); }}><Plus size={15} />Modul hinzufügen</button></div></div>
    {truncated && <div className="notice">Große Repositories: Statistiken berücksichtigen die neuesten 20.000 erreichbaren Commits pro Repository.</div>}
    <div className="modules-grid">{configs.map((config, index) => {
      const Icon = icons[config.type];
      return <article className="module" key={config.id}><header className="module-header"><div className="module-heading"><Icon size={16} /><h3>{config.title}</h3></div><div className="module-actions"><IconButton label={`${config.title} nach oben`} disabled={saving || index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></IconButton><IconButton label={`${config.title} nach unten`} disabled={saving || index === configs.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></IconButton><IconButton label={`${config.title} konfigurieren`} disabled={saving} onClick={() => { setError(''); setEditing(config); }}><SlidersHorizontal size={14} /></IconButton></div></header><ScopeLabel config={config} repos={repositories} /><div className="module-body"><ModuleContent config={config} snapshots={snapshots} /></div></article>;
    })}</div>
    {!configs.length && <EmptyState title="Platz für deinen eigenen Blick" icon={<BarChart3 size={28} />}>Füge ein Modul hinzu und wähle seine Repositories und den Zeitraum.</EmptyState>}
    {editing && <ModuleEditor initial={editing === 'new' ? undefined : editing} repoId={repoId} repositories={repositories} saving={saving} error={error} onClose={() => { if (!saving) setEditing(null); }} onSave={async config => { const next = editing === 'new' ? [...configs, config] : configs.map(c => c.id === config.id ? config : c); if (await persist(next)) setEditing(null); else setError('Modul konnte nicht gespeichert werden. Bitte erneut versuchen.'); }} onRemove={editing === 'new' ? undefined : async () => { if (await persist(configs.filter(c => c.id !== editing.id))) setEditing(null); else setError('Modul konnte nicht entfernt werden.'); }} />}
  </section>;
}
function ModuleEditor({ initial, repoId, repositories, onClose, onSave, onRemove, saving, error }: { initial?: ModuleConfig; repoId?: string; repositories: Repository[]; onClose: () => void; onSave: (config: ModuleConfig) => void; onRemove?: () => void; saving: boolean; error: string }) {
  const [type, setType] = useState<ModuleType>(initial?.type ?? 'authors');
  const [title, setTitle] = useState(initial?.title ?? MODULE_TYPES.authors.title);
  const [period, setPeriod] = useState(initial?.period ?? 30);
  const [repoIds, setRepoIds] = useState<string[]>(initial?.repoIds ?? (repoId ? [repoId] : []));
  return <Modal title={initial ? 'Modul konfigurieren' : 'Modul hinzufügen'} onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); onSave({ id: initial?.id ?? crypto.randomUUID(), type, title: title.trim(), period, repoIds }); }}>
      <div className="modal-body"><label className="form-field">Modultyp<select aria-label="Modultyp" value={type} disabled={saving} onChange={e => { const next = e.target.value as ModuleType; if (title === MODULE_TYPES[type].title) setTitle(MODULE_TYPES[next].title); setType(next); }}>{Object.entries(MODULE_TYPES).map(([key, value]) => <option key={key} value={key}>{value.title}</option>)}</select></label><p className="form-help">{MODULE_TYPES[type].description}</p>
        <label className="form-field">Titel<input value={title} maxLength={100} required disabled={saving} onChange={e => setTitle(e.target.value)} /></label>
        <label className="form-field">Zeitraum<select aria-label="Zeitraum" value={period} disabled={saving || type === 'workingTree'} onChange={e => setPeriod(Number(e.target.value) as ModuleConfig['period'])}>{PERIODS.map(p => <option value={p.value} key={p.value}>{p.label}</option>)}</select></label>
        <fieldset className="repo-picker" disabled={saving}><legend>Repositories</legend><label><input type="checkbox" checked={!repoIds.length} onChange={e => setRepoIds(e.target.checked ? [] : repositories.map(r => r.id))} />Alle geöffneten Repositories <small>einschließlich künftig geöffneter</small></label>{repositories.map(r => <label key={r.id} title={r.path}><input type="checkbox" checked={repoIds.includes(r.id)} onChange={e => setRepoIds(e.target.checked ? [...repoIds, r.id] : repoIds.filter(id => id !== r.id))} /><FolderGit2 size={14} /><span>{r.name}</span></label>)}</fieldset>
        <p className="form-help">Statistiken verwenden alle erreichbaren Branches und Tags. Merge-Commits und Binärdatei-Zeilen werden nicht mitgezählt. Keine Auswahl bedeutet alle Repositories.</p>{error && <p className="negative" role="alert">{error}</p>}
      </div><footer className="modal-footer">{onRemove && <button type="button" className="button danger-button" disabled={saving} onClick={onRemove}><X size={14} />Entfernen</button>}<div className="spacer" /><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Abbrechen</button><button className="button primary" disabled={saving || !title.trim()}>{saving ? 'Speichern …' : 'Modul speichern'}</button></footer>
    </form>
  </Modal>;
}
