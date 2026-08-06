import { expect, test, type Page } from '@playwright/test';

const senha = 'senha-forte-123';
const novoEmail = () => `alerta-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemplo.com`;
const p2 = (n: number) => String(n).padStart(2, '0');

async function criarConta(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.locator('#aEmail').fill(email);
  await page.locator('#aPass').fill(senha);
  await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
  await expect(page.locator('.views')).toBeVisible();
}

/* o .fab abre o menu de acesso rápido (mobile: botão redondo; web: aba lateral
   recolhida — o clique já expande). Escolher o item pelo NOME: a ordem no DOM
   difere entre as variantes (na web "Nova tarefa" fica no meio). */
async function abrirNovaTarefa(page: Page) {
  await page.locator('.fab').click();
  await page.locator('.quick-menu').getByRole('menuitem', { name: 'Nova tarefa' }).click();
  await expect(page.locator('#tTitle')).toBeVisible();
}

/* cria tarefa com hora = agora e lembrete "Na hora" → alerta devido imediatamente */
async function criarTarefaComLembrete(page: Page, title: string, prio?: 'baixa' | 'media' | 'alta') {
  await abrirNovaTarefa(page);
  await page.locator('#tTitle').fill(title);
  const now = new Date();
  await page.locator('#tDate').fill(`${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`);
  await page.locator('#tTime').fill(`${p2(now.getHours())}:${p2(now.getMinutes())}`);
  await page.locator('#tRemind').selectOption('0');
  if (prio) await page.locator(`.segmented [data-p="${prio}"]`).click();
  await page.getByRole('button', { name: 'Salvar tarefa' }).click();
}

test('alerta dispara na hora e "Vou iniciar" persiste após recarregar', async ({ page }) => {
  await criarConta(page, novoEmail());
  await criarTarefaComLembrete(page, 'Reunião importantíssima');
  const overlay = page.locator('.alert-overlay');
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.alert-title')).toContainText('Reunião importantíssima');
  await page.getByRole('button', { name: 'Vou iniciar' }).click();
  await expect(overlay).not.toBeVisible();
  // o ack vai para prefs.alerts pelo auto-save e sobrevive ao reload
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator('.views')).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.locator('.alert-overlay')).toHaveCount(0);
});

test('prorrogar +10 min fecha o alerta', async ({ page }) => {
  await criarConta(page, novoEmail());
  await criarTarefaComLembrete(page, 'Tarefa prorrogável');
  await expect(page.locator('.alert-overlay')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Prorrogar' }).click();
  await page.locator('.snooze-menu .chip', { hasText: '+10 min' }).click();
  await expect(page.locator('.alert-overlay')).not.toBeVisible();
});

test('prioridade alta estiliza o alerta como urgente', async ({ page }) => {
  await criarConta(page, novoEmail());
  await criarTarefaComLembrete(page, 'Emergência total', 'alta');
  await expect(page.locator('.alert-card')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.alert-card')).toHaveAttribute('data-p', 'alta');
  await page.getByRole('button', { name: 'Vou iniciar' }).click();
});

test('lembrete fica desabilitado sem hora definida', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaTarefa(page);
  await expect(page.locator('#tRemind')).toBeDisabled();
  await page.locator('#tTime').fill('10:00');
  await expect(page.locator('#tRemind')).toBeEnabled();
});

const NOTIF_DEFAULTS = {
  emails: [] as string[], whatsappNumber: '', emailEnabled: false, whatsappEnabled: false,
  timezone: 'America/Sao_Paulo', waInstance: false, providers: { email: true, whatsapp: true },
};

test('configurações de notificação salvam (mock da API)', async ({ page }) => {
  await page.route('**/api/notify/settings', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: NOTIF_DEFAULTS });
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { ...NOTIF_DEFAULTS, ...body } });
  });
  await page.route('**/api/notify/whatsapp/status', (route) =>
    route.fulfill({ json: { linked: false, connected: false, loggedIn: false } }),
  );
  await criarConta(page, novoEmail());
  await page.locator('.avatar').click();
  await page.getByRole('menuitem', { name: 'Configurações' }).click();
  await expect(page.locator('#cfgSound')).toBeVisible();
  // liga o e-mail e adiciona um destinatário
  await page.locator('.notif-row', { hasText: 'Lembretes por e-mail' }).locator('.switch').click();
  await page.getByRole('button', { name: 'Adicionar e-mail' }).click();
  await page.locator('.notif-mail-row input').fill('destino@exemplo.com');
  // liga o WhatsApp; letras no número são filtradas
  await page.locator('.notif-row', { hasText: 'Lembretes por WhatsApp' }).locator('.switch').click();
  await page.locator('#cfgWaNum').fill('55a41999998888'); // letras são filtradas
  await expect(page.locator('#cfgWaNum')).toHaveValue('5541999998888');
  await page.getByRole('button', { name: 'Salvar notificações' }).click();
  await expect(page.locator('.toast')).toContainText('Notificações salvas');
});

test('fluxo do QR do WhatsApp: aguardando → QR → conectado (mock)', async ({ page }) => {
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.route('**/api/notify/settings', (route) => route.fulfill({ json: NOTIF_DEFAULTS }));
  await page.route('**/api/notify/whatsapp/status', (route) =>
    route.fulfill({ json: { linked: true, connected: false, loggedIn: false } }),
  );
  await page.route('**/api/notify/whatsapp/connect', (route) =>
    route.fulfill({ json: { connected: false, loggedIn: false } }),
  );
  let calls = 0;
  await page.route('**/api/notify/whatsapp/qr', (route) => {
    calls++;
    if (calls <= 1) return route.fulfill({ json: { pending: true } });
    if (calls <= 2) return route.fulfill({ json: { qr: png } });
    return route.fulfill({ json: { connected: true } });
  });
  await criarConta(page, novoEmail());
  await page.locator('.avatar').click();
  await page.getByRole('menuitem', { name: 'Configurações' }).click();
  await page.locator('.notif-row', { hasText: 'Lembretes por WhatsApp' }).locator('.switch').click();
  await page.getByRole('button', { name: 'Conectar por QR code' }).click();
  await expect(page.locator('.wa-qrbox img')).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('.toast')).toContainText('WhatsApp conectado', { timeout: 12_000 });
});
