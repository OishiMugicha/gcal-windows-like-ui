import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTasks, matchesChanges, taskDay } from './tasks';
import { tasksRequest } from './google';
vi.mock('./google', () => ({ tasksRequest: vi.fn() }));
beforeEach(() => vi.mocked(tasksRequest).mockReset());
describe('Task civil dates', () => {
  it('uses the scheduled calendar day without converting time zones', () => {
    expect(taskDay({ id: '1', title: '', status: 'needsAction', due: '2026-09-30T00:00:00Z' })).toBe('2026-09-30');
  });
  it('requests civil date bounds across months and filters undated, deleted and completed tasks', async () => {
    vi.mocked(tasksRequest).mockResolvedValue({ items: [
      { id: 'yes', due: '2026-09-30T00:00:00Z', status: 'needsAction' },
      { id: 'no-date', status: 'needsAction' },
      { id: 'next', due: '2026-10-01T00:00:00Z', status: 'needsAction' },
      { id: 'deleted', due: '2026-09-30T00:00:00Z', deleted: true },
      { id: 'done', due: '2026-09-30T00:00:00Z', status: 'completed' },
    ] });
    expect((await loadTasks('a/b', '2026-09-30', '2026-09-30', false)).map(t => t.id)).toEqual(['yes']);
    const url = new URL('https://example.com/' + vi.mocked(tasksRequest).mock.calls[0][0]);
    expect(url.pathname).toContain('a%2Fb');
    expect(url.searchParams.get('dueMin')).toBe('2026-09-30T00:00:00Z');
    expect(url.searchParams.get('dueMax')).toBe('2026-10-01T00:00:00Z');
  });
  it('checks uncertain saves using edited fields and normalized dates', () => {
    const task = { id: '1', listId: 'a', title: 'Title', status: 'needsAction' as const };
    expect(matchesChanges(task, { due: null, notes: '' })).toBe(true);
    expect(matchesChanges(task, { title: 'Other' })).toBe(false);
    expect(matchesChanges(task, { status: 'completed' })).toBe(false);
  });
});
