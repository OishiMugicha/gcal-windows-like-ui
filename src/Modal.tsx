import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
let nextId = 0;
export default function Modal({ title, children, onClose, busy = false, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useRef('modal-' + nextId++);
  useEffect(() => {
    const element = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={id.current} className={'retro-dialog' + (wide ? ' wide' : '')}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="titlebar"><strong id={id.current}>{title}</strong><button aria-label="閉じる" onClick={onClose} disabled={busy}>×</button></div>
    {children}
  </dialog>;
}
