import { test, expect } from '@playwright/test';
test('optional display tool validates input and updates the visible range', async ({ page }) => {
  await page.addInitScript(() => {
    const registry = new Map();
    Object.defineProperty(document, 'modelContext', { value: {
      registerTool(tool: { name: string }, options: { signal: AbortSignal }) {
        registry.set(tool.name, tool);
        options.signal.addEventListener('abort', () => registry.delete(tool.name));
      },
    } });
    (window as unknown as { tools: Map<string, unknown> }).tools = registry;
  });
  await page.goto('/');
  expect(await page.evaluate(() => {
    const tools = (window as unknown as { tools: Map<string, { execute: (input: unknown) => unknown }> }).tools;
    return tools.get('configure_display_time_range')!.execute({ startMinute: 600, endMinute: 1320 });
  })).toEqual({ startMinute: 600, endMinute: 1320 });
  await expect(page.locator('.time-axis span').first()).toHaveText('10:00');
  await expect(page.locator('.time-axis span').last()).toHaveText('22:00');
  expect(await page.evaluate(() => {
    const tools = (window as unknown as { tools: Map<string, { execute: (input: unknown) => unknown }> }).tools;
    try { tools.get('configure_display_time_range')!.execute({ startMinute: 800, endMinute: 600 }); return false; } catch { return true; }
  })).toBe(true);
  await expect(page.locator('.time-axis span').first()).toHaveText('10:00');
});
