import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  workers: 1,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
