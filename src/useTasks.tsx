import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import Modal from './Modal';
import { ConnectionExpired, hasTasksAccess, OperationUncertain, TaskNotFound } from './google';
import { deleteTask, getTask, loadTaskLists, loadTasks, matchesChanges, patchTask, taskDay } from './tasks';
import type { Task, TaskChanges, TaskList } from './tasks';
interface Preferences { enabled: boolean; completed: boolean; lists: string[] | null; }
const key = 'calendar95.tasks';
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return { enabled: value.enabled === true, completed: value.completed === true,
      lists: Array.isArray(value.lists) ? value.lists.filter((id: unknown) => typeof id === 'string') : null };
  } catch { return { enabled: false, completed: false, lists: null }; }
}
const sameTask = (a: Task, b: Task) => a.id === b.id && a.listId === b.listId;
const message = (e: unknown) => e instanceof Error ? e.message : 'ToDoへの操作に失敗しました。';
export function useTasks({ connected, connecting, blocked, version, days, onExpired, onReconnect }: {
  connected: boolean; connecting: boolean; blocked: boolean; version: number; days: string[];
  onExpired: () => void; onReconnect: () => void;
}) {
  const [preferences, setPreferences] = useState(readPreferences);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [editorError, setEditorError] = useState('');
  const [uncertain, setUncertain] = useState<({ kind: 'update'; task: Task; changes: TaskChanges } | { kind: 'delete'; task: Task }) | null>(null);
  const dragging = useRef<Task | null>(null);
  const suppressClick = useRef(false);
  const [dropDay, setDropDay] = useState('');
  const revision = useRef(0), saving = useRef(false);
  const first = days[0], last = days.at(-1)!;
  const access = connected && hasTasksAccess();
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(preferences)); }
    catch { setError('ToDoの表示設定を保存できません。この画面内では利用できます。'); }
  }, [preferences]);
  const refresh = useCallback(async () => {
    if (!connected || connecting || !preferences.enabled || !hasTasksAccess() || saving.current) return;
    const requestId = ++revision.current;
    setLoading(true); setError('');
    try {
      const available = await loadTaskLists();
      const selected = available.filter(list => preferences.lists === null || preferences.lists.includes(list.id));
      const result = await Promise.all(selected.map(list => loadTasks(list.id, first, last, preferences.completed)));
      if (revision.current !== requestId) return;
      setLists(available); setTasks(result.flat()); setExpired(false);
    } catch (e) {
      if (revision.current !== requestId) return;
      setError(message(e));
      if (e instanceof ConnectionExpired) { setExpired(true); onExpired(); }
    } finally { if (revision.current === requestId) setLoading(false); }
  }, [connected, connecting, preferences, first, last, version]);
  useEffect(() => {
    if (connecting || !preferences.enabled) setTasks([]);
    if (!connected) { setTasks([]); setLists([]); setEditing(null); setUncertain(null); setError(''); setOperationError(''); }
    setLoading(false);
    void refresh();
    return () => { revision.current++; };
  }, [refresh, busy]);
  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', handler); document.addEventListener('visibilitychange', handler);
    return () => { window.removeEventListener('focus', handler); document.removeEventListener('visibilitychange', handler); };
  }, [refresh]);
  function replace(task: Task) { setTasks(current => current.map(t => sameTask(t, task) ? task : t)); }
  async function save(task: Task, changes: TaskChanges, fromEditor: boolean) {
    if (saving.current || blocked || connecting || uncertain) return;
    saving.current = true; setBusy(true); revision.current++; setLoading(false); setEditorError(''); setOperationError('');
    const original = tasks.find(current => sameTask(current, task)) || task;
    const optimistic = { ...task, ...changes };
    replace(optimistic);
    if (fromEditor) setEditing(null);
    try {
      const saved = await patchTask(task, changes);
      replace(saved);
      if (fromEditor) setEditing(null);
    } catch (e) {
      replace(original);
      if (fromEditor) setEditing(optimistic);
      if (e instanceof OperationUncertain) {
        setUncertain({ kind: 'update', task, changes });
        if (!fromEditor) setEditing(optimistic);
        setEditorError('保存結果が不明です。「保存結果を確認」を押してください。');
      } else {
        if (fromEditor) setEditorError(message(e)); else setOperationError(message(e));
        if (e instanceof ConnectionExpired) { setExpired(true); onExpired(); }
      }
    } finally { saving.current = false; setBusy(false); }
  }
  function remove(task: Task) { setTasks(current => current.filter(t => !sameTask(t, task))); }
  async function destroy(task: Task) {
    if (saving.current || blocked || connecting || uncertain) return;
    saving.current = true; setBusy(true); revision.current++; setLoading(false); setEditorError('');
    try {
      await deleteTask(task);
      remove(task); setEditing(null);
    } catch (e) {
      if (e instanceof TaskNotFound) { remove(task); setEditing(null); }
      else if (e instanceof OperationUncertain) {
        setUncertain({ kind: 'delete', task });
        setEditorError('削除結果が不明です。「削除結果を確認」を押してください。');
      } else {
        setEditorError(message(e));
        if (e instanceof ConnectionExpired) { setExpired(true); onExpired(); }
      }
    } finally { saving.current = false; setBusy(false); }
  }
  async function check() {
    if (!uncertain || saving.current || blocked || connecting) return;
    saving.current = true; setBusy(true); revision.current++; setLoading(false);
    try {
      const latest = await getTask(uncertain.task);
      if (uncertain.kind === 'delete') {
        if (latest.deleted) { remove(latest); setEditing(null); }
        else { replace(latest); setEditing(current => current && { ...current, etag: latest.etag }); setEditorError('ToDoはまだ残っています。確認して再度削除してください。'); }
        setUncertain(null); setExpired(false); return;
      }
      replace(latest);
      if (matchesChanges(latest, uncertain.changes)) { setUncertain(null); setEditing(null); }
      else {
        setEditing(current => current && { ...current, etag: latest.etag });
        setUncertain(null); setEditorError('Google側の最新状態を確認しました。入力内容を確認して保存してください。');
      }
      setExpired(false);
    } catch (e) {
      if (uncertain.kind === 'delete' && e instanceof TaskNotFound) {
        remove(uncertain.task); setUncertain(null); setEditing(null); return;
      }
      setEditorError(message(e));
      if (e instanceof ConnectionExpired) { setExpired(true); onExpired(); }
    } finally { saving.current = false; setBusy(false); }
  }
  const visible = access && preferences.enabled ? tasks.filter(task => taskDay(task) && !task.deleted
    && (preferences.completed || task.status !== 'completed')
    && (preferences.lists === null || preferences.lists.includes(task.listId))) : [];
  const disabled = busy || blocked || connecting || !!uncertain;
  function row(task: Task, placement: 'all-day' | 'month' | 'agenda') {
    return <button key={'task:' + task.listId + ':' + task.id}
      className={'task-row ' + (placement === 'month' ? 'month-event' : placement === 'agenda' ? 'agenda-item' : 'all-day-event') + (task.status === 'completed' ? ' completed' : '')}
      disabled={disabled} draggable={!disabled && placement !== 'agenda'}
      onDragStart={e => {
        if (disabled) { e.preventDefault(); return; }
        dragging.current = task; suppressClick.current = true;
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-calendar95-task', task.id);
      }}
      onDragEnd={() => { dragging.current = null; setDropDay(''); }}
      onPointerDown={() => { suppressClick.current = false; }}
      onClick={e => {
        if (disabled || saving.current || (e.detail !== 0 && suppressClick.current)) return;
        setEditing(task); setEditorError('');
      }}>{task.title || '（タイトルなし）'}</button>;
  }
  return {
    enabled: preferences.enabled, busy, loading, refresh,
    rows: (day: string, placement: 'all-day' | 'month' | 'agenda' = 'all-day') => visible.filter(t => taskDay(t) === day).map(t => row(t, placement)),
    dropTarget: (day: string) => ({
      'data-task-drop': dropDay === day ? 'active' : undefined,
      onDragOver: (e: DragEvent<HTMLDivElement>) => {
        if (!dragging.current || disabled) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropDay(day);
      },
      onDragLeave: (e: DragEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropDay('');
      },
      onDrop: (e: DragEvent<HTMLDivElement>) => {
        const task = dragging.current;
        dragging.current = null; setDropDay('');
        if (!task || disabled) return;
        e.preventDefault();
        if (taskDay(task) !== day) void save(task, { due: day + 'T00:00:00Z' }, false);
      },
    }),
    settings: <fieldset><legend>Google ToDo</legend>
      <label className="check"><input type="checkbox" checked={preferences.enabled} disabled={busy || connecting}
        onChange={e => setPreferences(p => ({ ...p, enabled: e.target.checked }))} />Google ToDoを表示</label>
      {preferences.enabled && <>
        {!access && <button type="button" disabled={connecting} onClick={onReconnect}>Google ToDoへのアクセスを許可</button>}
        <label className="check"><input type="checkbox" checked={preferences.completed} onChange={e => setPreferences(p => ({ ...p, completed: e.target.checked }))} />完了済みも表示</label>
        {lists.map(list => <label className="check" key={list.id}><input type="checkbox"
          checked={preferences.lists === null || preferences.lists.includes(list.id)} onChange={e => setPreferences(p => {
            const selected = p.lists ?? lists.map(l => l.id);
            return { ...p, lists: e.target.checked ? [...selected, list.id] : selected.filter(id => id !== list.id) };
          })} />{list.title}</label>)}
        <p className="field-note">ToDo設定はすぐに反映されます。日付のあるToDoを終日欄に表示します。</p>
      </>}
    </fieldset>,
    banner: preferences.enabled && (operationError || error || (connected && !access)) ? <div className="error-banner" role="alert">
      <span>{operationError || error || '設定からGoogle ToDoへのアクセスを許可してください。'}</span>
      <button onClick={() => { setOperationError(''); void refresh(); }} disabled={busy || loading || connecting}>ToDoを再取得</button>
    </div> : null,
    editor: editing && <TaskEditor task={editing} busy={busy || blocked || connecting} error={editorError} blocked={!!uncertain}
      onClose={() => { if (!saving.current && !connecting) { setEditing(null); setUncertain(null); void refresh(); } }}
      onDelete={() => void destroy(editing)} checkLabel={uncertain?.kind === 'delete' ? '削除結果を確認' : '保存結果を確認'}
      onSave={changes => void save(editing, changes, true)} onCheck={() => void check()}
      onReconnect={expired || !access ? onReconnect : undefined} />,
  };
}
function TaskEditor({ task, busy, blocked, error, onClose, onSave, onCheck, onReconnect, onDelete, checkLabel }: {
  task: Task; busy: boolean; blocked: boolean; error: string; onClose: () => void;
  onSave: (changes: TaskChanges) => void; onCheck: () => void; onReconnect?: () => void; onDelete: () => void; checkLabel: string;
}) {
  const fieldId = useId();
  const [title, setTitle] = useState(task.title), [notes, setNotes] = useState(task.notes || '');
  const [status, setStatus] = useState(task.status);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [day, setDay] = useState(taskDay(task));
  return <Modal title="ToDoの編集" busy={busy} onClose={onClose}>
    <form className="dialog-body" onSubmit={e => { e.preventDefault(); if (!busy && !blocked && !confirmDelete) onSave({ title: title.trim(), status,
      ...(task.assignmentInfo ? {} : { notes }), due: day ? day + 'T00:00:00Z' : null }); }}>
      <fieldset disabled={busy || blocked}>
        <label className="field">タイトル<input required maxLength={1024} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <div className="field"><label htmlFor={fieldId}>メモ</label><textarea id={fieldId} maxLength={8192} value={notes} disabled={!!task.assignmentInfo} onChange={e => setNotes(e.target.value)} /></div>
        {!!task.assignmentInfo && <p className="field-note">割り当てられたToDoのメモは元のサービスで編集してください。</p>}
        <div className="field"><label htmlFor={fieldId + '-status'}>状態</label><select id={fieldId + '-status'} value={status} onChange={e => setStatus(e.target.value as Task['status'])}>
          <option value="needsAction">未完了</option><option value="completed">完了</option>
        </select></div>
        <label className="field">日付<input type="date" value={day} onChange={e => setDay(e.target.value)} /></label>
        {!day && <p className="field-note">日付なしで保存するとカレンダーから非表示になります。</p>}
      </fieldset>
      {error && <p role="alert" className="error-text">{error}</p>}
      {onReconnect && <button type="button" disabled={busy} onClick={onReconnect}>入力を保持してGoogleに再接続</button>}
      {confirmDelete && !blocked && <div className="delete-confirm" role="alert">
        <p>このToDoを削除しますか？{!!task.assignmentInfo && ' 元のDocs・Chat側のタスクも削除されます。'}</p>
        <button type="button" disabled={busy} onClick={onDelete}>削除する</button>
        <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>キャンセル</button>
      </div>}
      <div className="dialog-actions"><button type="button" className="delete-button" disabled={busy || blocked} onClick={() => setConfirmDelete(true)}>削除…</button><button type="button" disabled={busy} onClick={onClose}>閉じる</button>
        {blocked ? <button type="button" disabled={busy} onClick={onCheck}>{checkLabel}</button>
          : <button className="default-button" disabled={busy || confirmDelete || !title.trim()}>保存</button>}
      </div>
    </form>
  </Modal>;
}
