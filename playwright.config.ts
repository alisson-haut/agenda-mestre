import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  fullyParallel: false,
  /* o dev local roda tudo numa máquina só (Vite + API + PGlite de conexão
     única) — mais workers geram flakiness por contenção, não por bugs */
  workers: 2,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5192',
    locale: 'pt-BR',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        /* câmera/microfone falsos: testes de captura sem hardware nem prompt */
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5192',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
