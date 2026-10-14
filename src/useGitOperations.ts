import { useEffect, useRef, useState } from 'react';
import type { GitAction, GitActionPlan, GitOperationResult } from '../shared/git-actions';
import { api, unwrap } from './lib';

export interface GitJob {
  requestId: string;
  label: string;
  phase: 'preparing' | 'confirmation' | 'running' | 'done';
  output: string;
  result?: GitOperationResult;
  error?: string;
}
export function useGitOperations(onFinished: (id: string) => void) {
  const [jobs, setJobs] = useState<Record<string, GitJob>>({});
  const [confirmation, setConfirmation] = useState<GitActionPlan | null>(null);
  const confirm = useRef<((value: boolean) => void) | null>(null);
  const busy = useRef(new Set<string>());
  const finished = useRef(onFinished);
  finished.current = onFinished;
  useEffect(() => {
    if (!window.gitDashboard) return;
    const unsubscribe = api().onGitOutput((event) => {
      setJobs((previous) => {
        const job = previous[event.repositoryId];
        if (!job || job.requestId !== event.requestId) return previous;
        return {
          ...previous,
          [event.repositoryId]: { ...job, output: (job.output + event.text).slice(0, 512_000) },
        };
      });
    });
    return () => {
      unsubscribe();
      confirm.current?.(false);
    };
  }, []);
  const resolveConfirmation = (accepted: boolean) => {
    confirm.current?.(accepted);
    confirm.current = null;
    setConfirmation(null);
  };
  const run = async (id: string, action: GitAction): Promise<boolean> => {
    if (busy.current.has(id) || confirm.current) return false;
    busy.current.add(id);
    const requestId = crypto.randomUUID();
    const update = (patch: Partial<GitJob>) =>
      setJobs((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
    setJobs((previous) => ({
      ...previous,
      [id]: { requestId, label: 'Git-Aktion vorbereiten', phase: 'preparing', output: '' },
    }));
    let executed = false;
    try {
      const plan = unwrap(await api().prepareGitAction(id, action));
      update({ label: plan.label, output: `${plan.command}\n` });
      if (plan.requiresConfirmation) {
        if (confirm.current) throw new Error('Bitte zuerst die andere Bestätigung schließen.');
        update({ phase: 'confirmation' });
        const accepted = await new Promise<boolean>((resolve) => {
          confirm.current = resolve;
          setConfirmation(plan);
        });
        if (!accepted) {
          update({ phase: 'done', error: 'Nicht ausgeführt.' });
          return false;
        }
      }
      update({ phase: 'running' });
      executed = true;
      const result = unwrap(await api().executeGitAction(id, plan.token, requestId, true));
      update({ phase: 'done', result, output: `${plan.command}\n${result.output}` });
      return result.success;
    } catch (error) {
      update({ phase: 'done', error: (error as Error).message });
      return false;
    } finally {
      busy.current.delete(id);
      if (executed) finished.current(id);
    }
  };
  const cancel = async (id: string) => {
    const job = jobs[id];
    if (job?.phase === 'running') unwrap(await api().cancelGitOperation(job.requestId));
  };
  return { jobs, run, cancel, confirmation, resolveConfirmation };
}
