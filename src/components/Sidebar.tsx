import { useCallback, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderGit2,
  GitBranch,
  GitFork,
  LayoutGrid,
  Plus,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import type { Repository, RepoSnapshot } from '../../shared/types';
import { IconButton } from './UI';
import { FolderContextMenu, type FolderMenuPosition } from './FolderContextMenu';

interface Props {
  repositories: Repository[];
  snapshots: RepoSnapshot[];
  active: string;
  onHome: () => void;
  onOpen: (id: string, branch?: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onSettings: () => void;
  onScan: (repositoryId: string) => void;
}
export function Sidebar({
  repositories,
  snapshots,
  active,
  onHome,
  onOpen,
  onAdd,
  onRemove,
  onSettings,
  onScan,
}: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [folderMenu, setFolderMenu] = useState<FolderMenuPosition | null>(null);
  const closeFolderMenu = useCallback(() => setFolderMenu(null), []);
  const toggle = (key: string, set: Set<string>, update: (value: Set<string>) => void) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    update(next);
  };
  const groups = new Map<string, Repository[]>();
  for (const repo of repositories.filter((r) =>
    `${r.name} ${r.path}`.toLowerCase().includes(query.toLowerCase()),
  )) {
    const parent = repo.path.replace(/[\\/][^\\/]+[\\/]?$/, '');
    groups.set(parent, [...(groups.get(parent) ?? []), repo]);
  }
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <GitFork size={21} />
        </span>
        <div>
          Git Dashboard<span>LOCAL WORKSPACE</span>
        </div>
      </div>
      <button className={`nav-home ${active === 'home' ? 'selected' : ''}`} onClick={onHome}>
        <LayoutGrid size={17} />
        <span>Übersicht</span>
        <span className="count">{repositories.length}</span>
      </button>
      <div className="sidebar-section-title">
        <span>REPOSITORIES</span>
        <IconButton label="Repository öffnen" onClick={onAdd}>
          <Plus size={16} />
        </IconButton>
      </div>
      <label className="search-field sidebar-search">
        <Search size={14} />
        <input
          aria-label="Repositories filtern"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Repositories filtern …"
        />
      </label>
      <div className="repository-tree" aria-label="Repository-Baum">
        {[...groups].map(([parent, repos]) => (
          <div className="tree-group" key={parent}>
            <button
              className="tree-parent"
              title={parent}
              aria-expanded={!collapsedGroups.has(parent)}
              aria-haspopup="menu"
              onContextMenu={(event) => {
                event.preventDefault();
                setFolderMenu({
                  repositoryId: repos[0].id,
                  x: event.clientX,
                  y: event.clientY,
                  trigger: event.currentTarget,
                });
              }}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setFolderMenu({
                    repositoryId: repos[0].id,
                    x: rect.left,
                    y: rect.bottom,
                    trigger: event.currentTarget,
                  });
                }
              }}
              onClick={() => toggle(parent, collapsedGroups, setCollapsedGroups)}
            >
              {collapsedGroups.has(parent) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <Folder size={13} />
              <span>{parent.split(/[\\/]/).pop() || parent}</span>
            </button>
            {!collapsedGroups.has(parent) &&
              repos.map((repo) => {
                const snapshot = snapshots.find((s) => s.repository.id === repo.id);
                return (
                  <div key={repo.id}>
                    <div className={`tree-repo ${active === repo.id ? 'selected' : ''}`}>
                      <button
                        className="tree-expander"
                        aria-label={`Branches von ${repo.name}`}
                        aria-expanded={expanded.has(repo.id)}
                        onClick={() => toggle(repo.id, expanded, setExpanded)}
                      >
                        {expanded.has(repo.id) ? (
                          <ChevronDown size={13} />
                        ) : (
                          <ChevronRight size={13} />
                        )}
                      </button>
                      <button
                        className="repo-select"
                        aria-label={repo.name}
                        title={repo.path}
                        onClick={() => onOpen(repo.id)}
                      >
                        <FolderGit2 size={16} />
                        <span>{repo.name}</span>
                        {snapshot?.error ? (
                          <span className="status-dot danger" title="Repository nicht verfügbar" />
                        ) : (
                          !!snapshot?.workingFiles.length && (
                            <span
                              className="status-dot"
                              title={`${snapshot.workingFiles.length} lokale Änderungen`}
                            />
                          )
                        )}
                      </button>
                      <button
                        className="tree-close"
                        title={`${repo.name} aus Workspace entfernen`}
                        aria-label={`${repo.name} aus Workspace entfernen`}
                        onClick={() => onRemove(repo.id)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    {expanded.has(repo.id) && (
                      <div className="tree-branches">
                        {snapshot?.branches.length ? (
                          snapshot.branches.map((branch) => (
                            <button
                              key={branch.ref}
                              className={branch.current ? 'current-branch' : ''}
                              title={branch.ref}
                              onClick={() => onOpen(repo.id, branch.ref)}
                            >
                              <GitBranch size={12} />
                              <span>{branch.name}</span>
                              {branch.current && <span className="branch-current" />}
                            </button>
                          ))
                        ) : (
                          <span className="tree-hint">
                            {snapshot?.error ? 'Nicht verfügbar' : 'Noch keine Branches'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
        {!repositories.length && (
          <div className="sidebar-empty">
            Öffne lokale Repositories,
            <br />
            um deinen Workspace aufzubauen.
          </div>
        )}
        {!!repositories.length && !groups.size && (
          <div className="sidebar-empty">Keine Treffer.</div>
        )}
      </div>
      <button className="sidebar-add" onClick={onAdd}>
        <Plus size={16} />
        Repository öffnen<span>⌘ / Ctrl O</span>
      </button>
      <button className="sidebar-settings" onClick={onSettings}>
        <Settings2 size={16} />
        Einstellungen
        <span className="local-dot" />
      </button>
      {folderMenu && (
        <FolderContextMenu position={folderMenu} onClose={closeFolderMenu} onScan={onScan} />
      )}
    </aside>
  );
}
