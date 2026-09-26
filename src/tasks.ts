import { addDays } from './calendar';
import { tasksRequest } from './google';
export interface TaskList { id: string; title: string; }
export interface GoogleTask {
  id: string; title: string; notes?: string; due?: string | null;
  status: 'needsAction' | 'completed'; etag?: string; deleted?: boolean;
  assignmentInfo?: unknown;
}
export interface Task extends GoogleTask { listId: string; }
export type TaskChanges = Partial<Pick<GoogleTask, 'title' | 'notes' | 'due' | 'status'>>;
interface Page<T> { items?: T[]; nextPageToken?: string; }
async function pages<T>(path: string, params: URLSearchParams): Promise<T[]> {
  const result: T[] = [];
  do {
    const page = await tasksRequest<Page<T>>(path + '?' + params);
    result.push(...(page.items || []));
    if (!page.nextPageToken) break;
    params.set('pageToken', page.nextPageToken);
  } while (true);
  return result;
}
export function loadTaskLists() {
  return pages<TaskList>('users/@me/lists', new URLSearchParams({ maxResults: '100' }));
}
export function taskDay(task: GoogleTask) { return task.due?.slice(0, 10) || ''; }
export async function loadTasks(listId: string, first: string, last: string, completed: boolean): Promise<Task[]> {
  const raw = await pages<GoogleTask>('lists/' + encodeURIComponent(listId) + '/tasks', new URLSearchParams({
    maxResults: '100', dueMin: first + 'T00:00:00Z', dueMax: addDays(last, 1) + 'T00:00:00Z',
    showCompleted: String(completed), showHidden: String(completed), showDeleted: 'false', showAssigned: 'true',
  }));
  return raw.filter(t => !t.deleted && taskDay(t) >= first && taskDay(t) <= last && (completed || t.status !== 'completed'))
    .map(t => ({ ...t, listId }));
}
const pathFor = (task: Task) => 'lists/' + encodeURIComponent(task.listId) + '/tasks/' + encodeURIComponent(task.id);
export async function getTask(task: Task): Promise<Task> {
  return { ...await tasksRequest<GoogleTask>(pathFor(task)), listId: task.listId };
}
export async function patchTask(task: Task, changes: TaskChanges): Promise<Task> {
  return { ...await tasksRequest<GoogleTask>(pathFor(task), {
    method: 'PATCH', body: JSON.stringify(changes), headers: task.etag ? { 'If-Match': task.etag } : {},
  }), listId: task.listId };
}
export function matchesChanges(task: Task, changes: TaskChanges) {
  return Object.entries(changes).every(([key, value]) => key === 'due'
    ? taskDay(task) === (typeof value === 'string' ? value.slice(0, 10) : '')
    : (task[key as keyof Task] || '') === (value || ''));
}

export async function deleteTask(task: Task): Promise<void> {
  await tasksRequest<void>(pathFor(task), { method: 'DELETE', headers: task.etag ? { 'If-Match': task.etag } : {} });
}
