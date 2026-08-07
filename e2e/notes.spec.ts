import { expect, test, type Page } from '@playwright/test';

const senha = 'senha-forte-123';
const novoEmail = () => `nota-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemplo.com`;

async function criarConta(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.locator('#aEmail').fill(email);
  await page.locator('#aPass').fill(senha);
  await page.locator('#aPass2').fill(senha);
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  /* sem auto-login: volta ao login com banner e e-mail preservado */
  await expect(page.locator('.auth-ok')).toBeVisible();
  await page.locator('#aPass').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('.views')).toBeVisible();
}

/* abre o modal de nota pelo menu de acesso rápido (item pelo NOME) */
async function abrirNovaNota(page: Page) {
  await page.locator('.fab').click();
  await page.locator('.quick-menu').getByRole('menuitem', { name: 'Nova nota' }).click();
  await expect(page.locator('#nTitle')).toBeVisible();
}

test('cria nota, chip aparece no mês e reabre pelo chip', async ({ page }) => {
  await criarConta(page, novoEmail());
  await page.locator('.view-tab[data-view="mes"]').click();

  await abrirNovaNota(page);
  await expect(page.locator('#noteDlg .dlg-title')).toContainText('Nova nota');
  await page.locator('#nTitle').fill('Nota do teste e2e');
  await page.locator('#nBody').fill('Corpo da nota com detalhes.');
  await page.locator('#noteDlg').getByRole('button', { name: 'Salvar nota' }).click();
  await expect(page.locator('.toast')).toContainText('Nota criada');

  /* chip marcado diferente no dia de criação (hoje) */
  const chip = page.locator('.note-chip', { hasText: 'Nota do teste e2e' }).first();
  await expect(chip).toBeVisible();

  /* clicar no chip reabre a nota em edição */
  await chip.click();
  await expect(page.locator('#noteDlg .dlg-title')).toContainText('Editar nota');
  await expect(page.locator('#nTitle')).toHaveValue('Nota do teste e2e');
  await page.locator('#noteDlg [aria-label="Fechar"]').click();
});

test('nota persiste após recarregar', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaNota(page);
  await page.locator('#nTitle').fill('Nota persistente');
  await page.locator('#noteDlg').getByRole('button', { name: 'Salvar nota' }).click();
  await expect(page.locator('.toast')).toContainText('Nota criada');

  await page.reload();
  await expect(page.locator('.views')).toBeVisible();
  await page.locator('.view-tab[data-view="mes"]').click();
  await expect(page.locator('.note-chip', { hasText: 'Nota persistente' }).first()).toBeVisible();
});

test('nota com foto envia para o storage e mostra a mídia', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaNota(page);
  await page.locator('#nTitle').fill('Nota com foto');

  /* injeta um PNG 1×1 direto no input oculto de foto (mesmo caminho do picker) */
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('#noteDlg input[type="file"][accept="image/*"]').setInputFiles({
    name: 'pixo.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.locator('#noteDlg .media-item img')).toBeVisible();
  /* upload de 70 bytes conclui rápido — o botão volta a "Salvar nota" */
  await expect(page.locator('#noteDlg').getByRole('button', { name: 'Salvar nota' })).toBeEnabled({ timeout: 15_000 });
  await page.locator('#noteDlg').getByRole('button', { name: 'Salvar nota' }).click();
  await expect(page.locator('.toast')).toContainText('Nota criada');

  /* reabre e a mídia continua lá (agora servida por /api/files) */
  await page.locator('.view-tab[data-view="mes"]').click();
  await page.locator('.note-chip', { hasText: 'Nota com foto' }).first().click();
  await expect(page.locator('#noteDlg .media-item img')).toBeVisible();
  await page.locator('#noteDlg [aria-label="Fechar"]').click();
});

test('gerar tarefa a partir da nota pré-preenche e vincula', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaNota(page);
  await page.locator('#nTitle').fill('Nota que vira tarefa');
  await page.locator('#noteDlg').getByRole('button', { name: 'Gerar tarefa' }).click();

  /* TaskModal abre pré-preenchido com o título e o dia da nota */
  await expect(page.locator('#tTitle')).toHaveValue('Nota que vira tarefa');
  await page.getByRole('button', { name: 'Salvar tarefa' }).click();
  await expect(page.locator('.toast')).toContainText('Tarefa criada a partir da nota');

  /* o vínculo taskId fica gravado na nota */
  const nota = await page.evaluate(async () => {
    const r = await fetch('/api/notes', { credentials: 'same-origin' });
    const j = await r.json();
    return j.notes.find((n: any) => n.title === 'Nota que vira tarefa');
  });
  expect(nota.taskId).toBeTruthy();
});

test('excluir nota pede confirmação', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaNota(page);
  await page.locator('#nTitle').fill('Nota protegida');
  await page.locator('#noteDlg').getByRole('button', { name: 'Salvar nota' }).click();
  await expect(page.locator('.toast')).toContainText('Nota criada');

  await page.locator('.view-tab[data-view="mes"]').click();
  await page.locator('.note-chip', { hasText: 'Nota protegida' }).first().click();
  await page.locator('#noteDlg [aria-label="Excluir nota"]').click();
  await expect(page.locator('#confirmDlg')).toHaveClass(/open/);
  await page.locator('#confirmDlg').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.locator('.toast')).toContainText('Nota excluída');
  await expect(page.locator('.note-chip', { hasText: 'Nota protegida' })).toHaveCount(0);
});

test('remover mídia pede confirmação e apaga do servidor', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaNota(page);
  await page.locator('#nTitle').fill('Nota com foto removível');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('#noteDlg input[type="file"][accept="image/*"]').setInputFiles({
    name: 'apagavel.png', mimeType: 'image/png', buffer: png,
  });
  await expect(page.locator('#noteDlg').getByRole('button', { name: 'Salvar nota' })).toBeEnabled({ timeout: 15_000 });
  await page.locator('#noteDlg').getByRole('button', { name: 'Salvar nota' }).click();
  await expect(page.locator('.toast')).toContainText('Nota criada');

  /* reabre e remove a mídia com confirmação — o DELETE tem que chegar ao banco */
  await page.locator('.view-tab[data-view="mes"]').click();
  await page.locator('.note-chip', { hasText: 'Nota com foto removível' }).first().click();
  await expect(page.locator('#noteDlg .media-item img')).toBeVisible();
  await page.locator('#noteDlg .m-x').click();
  await expect(page.locator('#confirmDlg')).toHaveClass(/open/);
  const delResp = page.waitForResponse((r) => r.url().includes('/api/files/') && r.request().method() === 'DELETE');
  await page.locator('#confirmDlg').getByRole('button', { name: 'Excluir' }).click();
  expect((await delResp).status()).toBe(200);
  await expect(page.locator('#noteDlg .media-item')).toHaveCount(0);

  /* reload: o arquivo NÃO volta (row apagada no banco) */
  await page.locator('#noteDlg [aria-label="Fechar"]').click();
  await page.reload();
  await expect(page.locator('.views')).toBeVisible();
  await page.locator('.view-tab[data-view="mes"]').click();
  await page.locator('.note-chip', { hasText: 'Nota com foto removível' }).first().click();
  await expect(page.locator('#noteDlg .media-item')).toHaveCount(0);
  await page.locator('#noteDlg [aria-label="Fechar"]').click();
});

test('áudio por arquivo aparece com player (velocidade até 3x)', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaNota(page);
  await page.locator('#nTitle').fill('Nota com áudio');

  /* WAV PCM mínimo válido (header RIFF + 32 amostras) */
  const sampleRate = 8000, samples = 32;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  await page.locator('#noteDlg input[type="file"][accept="audio/*"]').setInputFiles({
    name: 'som.wav', mimeType: 'audio/wav', buffer: wav,
  });

  const item = page.locator('#noteDlg .media-item.audio');
  await expect(item.locator('.ap-btn')).toBeVisible();
  /* velocidade cicla até 3x */
  const rate = item.locator('.ap-rate');
  await rate.click(); await expect(rate).toHaveText('1.5x');
  await rate.click(); await expect(rate).toHaveText('2x');
  await rate.click(); await expect(rate).toHaveText('3x');

  await expect(page.locator('#noteDlg').getByRole('button', { name: 'Salvar nota' })).toBeEnabled({ timeout: 15_000 });
  await page.locator('#noteDlg').getByRole('button', { name: 'Salvar nota' }).click();
  await expect(page.locator('.toast')).toContainText('Nota criada');

  /* persistiu: reabre com o player */
  await page.locator('.view-tab[data-view="mes"]').click();
  await page.locator('.note-chip', { hasText: 'Nota com áudio' }).first().click();
  await expect(page.locator('#noteDlg .media-item.audio .ap-btn')).toBeVisible();
  await page.locator('#noteDlg [aria-label="Fechar"]').click();
});

test('lightbox de imagem abre e Escape fecha só ele', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaNota(page);
  await page.locator('#nTitle').fill('Nota com lightbox');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('#noteDlg input[type="file"][accept="image/*"]').setInputFiles({
    name: 'ver.png', mimeType: 'image/png', buffer: png,
  });
  await expect(page.locator('#noteDlg .media-item img')).toBeVisible();

  await page.locator('#noteDlg .media-item img').click();
  await expect(page.locator('.mviewer img')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.mviewer')).toHaveCount(0);
  await expect(page.locator('#noteDlg')).toHaveClass(/open/);
  await page.locator('#noteDlg [aria-label="Fechar"]').click();
});
