import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { addDays, consecutiveDays } from './calendar';

// A bounded, three-week strip is recycled in whole-week increments. The offset
// stays in pixels while a gesture is active; dates are committed only at rest.
export function useWeekScroll(start: string, enabled: boolean, resetVersion: number,
  blocked: boolean, onChange: (day: string) => void) {
  const viewport = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState(start);
  const [moving, setMoving] = useState(false);
  const controller = useRef<{ shift: (days: number) => void } | null>(null);
  const current = useRef({ start, blocked, onChange });
  current.current = { start, blocked, onChange };

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!enabled || !el) return;
    let origin = start, width = 0, offset = 0, target = 0;
    let timer = 0, frame = 0, active = false, dragging = false;
    function paint() { el!.style.setProperty('--week-offset', `${offset}px`); }
    function recycle() {
      const shift = offset >= 14 * width ? 7 : offset <= 0 ? -7 : 0;
      if (!shift || !width) return;
      origin = addDays(origin, shift);
      offset -= shift * width; target -= shift * width;
      flushSync(() => setBase(origin));
    }
    function stopAnimation() { cancelAnimationFrame(frame); clearTimeout(timer); }
    function begin() {
      if (!active) { active = true; setMoving(true); }
    }
    function finish() {
      recycle(); paint(); active = false; setMoving(false);
      const day = addDays(origin, Math.round(offset / width) - 7);
      current.current.onChange(day);
    }
    function animate(to: number) {
      stopAnimation(); begin(); target = to;
      const from = offset, distance = to - from, began = performance.now();
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        offset = to;
        while (offset >= 14 * width || offset <= 0) recycle();
        finish(); return;
      }
      function tick(now: number) {
        const progress = Math.min(1, (now - began) / 160);
        // target may be rebased while the strip is recycled.
        offset = target - distance * Math.pow(1 - progress, 3);
        recycle(); paint();
        if (progress < 1) frame = requestAnimationFrame(tick);
        else finish();
      }
      frame = requestAnimationFrame(tick);
    }
    function resize() {
      const nextWidth = Math.max(1, (el!.clientWidth - 58) / 7);
      if (nextWidth === width) return;
      stopAnimation(); active = false; setMoving(false);
      origin = current.current.start; setBase(origin);
      width = nextWidth;
      offset = target = 7 * width;
      el!.style.setProperty('--week-column-width', `${width}px`); paint();
    }
    function wheel(e: WheelEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const delta = e.shiftKey ? (e.deltaX || e.deltaY) : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
      if (!delta) return;
      e.preventDefault();
      if (dragging || current.current.blocked) return;
      stopAnimation(); begin();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 7 * width : 1;
      offset += delta * unit;
      while (offset >= 14 * width || offset <= 0) recycle();
      target = offset; paint();
      timer = window.setTimeout(() => animate(Math.round(offset / width) * width), 150);
    }
    function pointerDown(e: PointerEvent) {
      if (active) { e.preventDefault(); e.stopPropagation(); return; }
      if (e.button === 0) dragging = true;
    }
    function release() { dragging = false; }
    function dragStart(e: DragEvent) {
      if (active) { e.preventDefault(); return; }
      dragging = true;
    }
    function click(e: MouseEvent) {
      if (active) { e.preventDefault(); e.stopPropagation(); }
    }
    controller.current = { shift(days) {
      if (dragging || current.current.blocked) return;
      animate((Math.round((active ? target : offset) / width) + days) * width);
    } };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(el);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('pointerdown', pointerDown, true);
    el.addEventListener('click', click, true);
    el.addEventListener('dragstart', dragStart, true);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('dragend', release);
    window.addEventListener('drop', release);
    window.addEventListener('blur', release);
    return () => {
      stopAnimation(); observer.disconnect(); controller.current = null;
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('pointerdown', pointerDown, true);
      el.removeEventListener('click', click, true);
      el.removeEventListener('dragstart', dragStart, true);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('dragend', release);
      window.removeEventListener('drop', release);
      window.removeEventListener('blur', release);
    };
    // Committed scroll positions must not restart the gesture controller.
    // All external jumps increment resetVersion.
  }, [enabled, resetVersion]);

  return { viewport, moving: enabled && moving,
    renderDays: consecutiveDays(addDays(base, -7), 21),
    shift: (days: number) => controller.current?.shift(days) };
}
