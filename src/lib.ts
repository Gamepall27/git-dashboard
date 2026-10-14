import type { DashboardAPI, Result } from '../shared/types';
export function api(): DashboardAPI {
  if (!window.gitDashboard) throw new Error('Bitte die Desktop-App mit „npm run dev“ starten. Im Browser ist kein Zugriff auf lokale Repositories möglich.');
  return window.gitDashboard;
}
export function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error); return result.data; }
export function number(value: number) { return new Intl.NumberFormat('de-DE').format(value); }
export function shortDate(value: string) { return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short' }).format(new Date(value)); }
export function fullDate(value: string) { return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
export function relativeDate(value: string) {
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  const r = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return 'gerade eben';
  if (Math.abs(seconds) < 3600) return r.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400) return r.format(Math.round(seconds / 3600), 'hour');
  if (Math.abs(seconds) < 86400 * 7) return r.format(Math.round(seconds / 86400), 'day');
  return shortDate(value);
}
