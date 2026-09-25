import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Modal from './Modal';
import { ConnectionExpired, hasTasksAccess, OperationUncertain } from './google';
import { getTask, loadTaskLists, loadTasks, matchesChanges, patchTask, taskDay } from './tasks';
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
  const [uncertain, setUncertain] = useState<{ task: Task; changes: TaskChanges } | null>(null);
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
        setUncertain({ task, changes });
        if (!fromEditor) setEditing(task);
        setEditorError('保存結果が不明です。「保存結果を確認」を押してください。');
      } else {
        if (fromEditor) setEditorError(message(e)); else setOperationError(message(e));
        if (e instanceof ConnectionExpired) { setExpired(true); onExpired(); }
      }
    } finally { saving.current = false; setBusy(false); }
  }
  async function check() {
    if (!uncertain || saving.current) return;
    saving.current = true; setBusy(true);
    try {
      const latest = await getTask(uncertain.task);
      replace(latest);
      if (matchesChanges(latest, uncertain.changes)) { setUncertain(null); setEditing(null); }
      else {
        setEditing(current => current && { ...current, etag: latest.etag });
        setUncertain(null); setEditorError('Google側の最新状態を確認しました。入力内容を確認して保存してください。');
      }
      setExpired(false);
    } catch (e) {
      setEditorError(message(e));
      if (e instanceof ConnectionExpired) { setExpired(true); onExpired(); }
    } finally { saving.current = false; setBusy(false); }
  }
  const visible = access && preferences.enabled ? tasks.filter(task => taskDay(task) && !task.deleted
    && (preferences.completed || task.status !== 'completed')
    && (preferences.lists === null || preferences.lists.includes(task.listId))) : [];
  function row(task: Task) {
    return <div key={'task:' + task.listId + ':' + task.id} className={'task-row' + (task.status === 'completed' ? ' completed' : '')}>
      <input type="checkbox" aria-label={task.title + 'を完了'} checked={task.status === 'completed'} disabled={busy || blocked || connecting || !!uncertain}
        onChange={e => void save(task, { status: e.target.checked ? 'completed' : 'needsAction' }, false)} />
      <button className="task-title" onClick={() => { if (saving.current || blocked || connecting || uncertain) return; setEditing(task); setEditorError(''); }} disabled={busy || blocked || connecting || !!uncertain}>{task.title || '（タイトルなし）'}</button>
    </div>;
  }
  return {
    enabled: preferences.enabled, busy, loading, refresh,
    rows: (day: string) => visible.filter(t => taskDay(t) === day).map(row),
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
    editor: editing && <TaskEditor task={editing} busy={busy || connecting} error={editorError} blocked={!!uncertain}
      onClose={() => { if (!saving.current && !connecting) { setEditing(null); setUncertain(null); void refresh(); } }}
      onSave={changes => void save(editing, changes, true)} onCheck={() => void check()}
      onReconnect={expired || !access ? onReconnect : undefined} />,
  };
}
function TaskEditor({ task, busy, blocked, error, onClose, onSave, onCheck, onReconnect }: {
  task: Task; busy: boolean; blocked: boolean; error: string; onClose: () => void;
  onSave: (changes: TaskChanges) => void; onCheck: () => void; onReconnect?: () => void;
}) {
  const fieldId = useId();
  const [title, setTitle] = useState(task.title), [notes, setNotes] = useState(task.notes || '');
  const [day, setDay] = useState(taskDay(task));
  return <Modal title="ToDoの編集" busy={busy} onClose={onClose}>
    <form className="dialog-body" onSubmit={e => { e.preventDefault(); if (!busy && !blocked) onSave({ title: title.trim(),
      ...(task.assignmentInfo ? {} : { notes }), due: day ? day + 'T00:00:00Z' : null }); }}>
      <fieldset disabled={busy || blocked}>
        <label className="field">タイトル<input required maxLength={1024} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <div className="field"><label htmlFor={fieldId}>メモ</label><textarea id={fieldId} maxLength={8192} value={notes} disabled={!!task.assignmentInfo} onChange={e => setNotes(e.target.value)} /></div>
        {!!task.assignmentInfo && <p className="field-note">割り当てられたToDoのメモは元のサービスで編集してください。</p>}
        <label className="field">日付<input type="date" value={day} onChange={e => setDay(e.target.value)} /></label>
        {!day && <p className="field-note">日付なしで保存するとカレンダーから非表示になります。</p>}
      </fieldset>
      {error && <p role="alert" className="error-text">{error}</p>}
      {onReconnect && <button type="button" disabled={busy} onClick={onReconnect}>入力を保持してGoogleに再接続</button>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>閉じる</button>
        {blocked ? <button type="button" disabled={busy} onClick={onCheck}>保存結果を確認</button>
          : <button className="default-button" disabled={busy || !title.trim()}>保存</button>}
      </div>
    </form>
  </Modal>;
}
