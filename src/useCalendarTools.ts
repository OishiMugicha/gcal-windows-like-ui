import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import type { Dispatch, SetStateAction } from 'react';
import type { Settings } from './types';
interface ModelContext {
  registerTool(tool: {
    name: string; title: string; description: string; inputSchema: object;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute(input: unknown): unknown;
  }, options: { signal: AbortSignal }): void | Promise<void>;
}
export function useCalendarTools(setSettings: Dispatch<SetStateAction<Settings>>) {
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: 'configure_display_time_range',
        title: 'カレンダーの表示時間帯を設定',
        description: 'Set the visible top/bottom time bounds for day and week views. Minutes after midnight; an end above 1440 means the next day. Changes display settings only, never Google events.',
        inputSchema: { type: 'object', properties: { startMinute: { type: 'integer', minimum: 0, maximum: 1410, multipleOf: 30 }, endMinute: { type: 'integer', minimum: 30, maximum: 2850, multipleOf: 30 } }, required: ['startMinute', 'endMinute'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input: unknown) {
          if (!input || typeof input !== 'object') throw new Error('Expected time range.');
          const { startMinute, endMinute } = input as Record<string, unknown>;
          if (typeof startMinute !== 'number' || typeof endMinute !== 'number' ||
              !Number.isInteger(startMinute) || !Number.isInteger(endMinute) ||
              startMinute < 0 || startMinute >= 1440 || endMinute <= startMinute ||
              endMinute - startMinute > 1440 || startMinute % 30 || endMinute % 30) throw new Error('Invalid time range.');
          flushSync(() => setSettings(s => ({ ...s, startMinute, endMinute })));
          return { startMinute, endMinute };
        },
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* The browser's optional integration must never block the calendar. */ }
    return () => lifecycle.abort();
  }, [setSettings]);
}
