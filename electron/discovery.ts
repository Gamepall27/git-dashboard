import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { DiscoveredRepository, Repository, RepositoryScan } from '../shared/types';
import { git, inspectRepository } from './git';

export async function scanRepositories(
  parentPath: string,
  opened: Repository[],
): Promise<RepositoryScan> {
  const entries = await readdir(parentPath, { withFileTypes: true });
  // Check Git once so a missing installation is reported as a scan error.
  await git(parentPath, ['--version']);
  const directories = entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
  const found = new Map<string, DiscoveredRepository>();
  const warnings: RepositoryScan['warnings'] = [];
  const openedIds = new Set(opened.map((repo) => repo.id));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, directories.length) }, async () => {
      while (cursor < directories.length) {
        const entry = directories[cursor++];
        const childPath = path.join(parentPath, entry.name);
        try {
          // rev-parse alone would also find an ancestor repository. Require a
          // marker in the direct child; worktrees use a file rather than a directory.
          let marker;
          try {
            marker = await lstat(path.join(childPath, '.git'));
          } catch (error) {
            if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
              continue;
            throw error;
          }
          if (!marker.isDirectory() && !marker.isFile() && !marker.isSymbolicLink()) continue;
          const repository = await inspectRepository(childPath);
          const canonicalChild = await realpath(childPath);
          const normalize = (value: string) =>
            process.platform === 'win32' ? value.toLowerCase() : value;
          if (normalize(repository.path) !== normalize(canonicalChild)) continue;
          found.set(repository.id, { ...repository, alreadyOpen: openedIds.has(repository.id) });
        } catch (error) {
          warnings.push({ path: childPath, error: (error as Error).message });
        }
      }
    }),
  );
  return {
    parentPath,
    repositories: [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')),
    warnings: warnings.sort((a, b) => a.path.localeCompare(b.path, 'de')),
  };
}
