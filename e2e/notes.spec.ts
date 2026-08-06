import { expect, test, type Page } from '@playwright/test';

const senha = 'senha-forte-123';
const novoEmail = () => `nota-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemplo.com`;

async function criarConta(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.locator('#aEmail').fill(email);
  await page.locator('#aPass').fill(senha);
  await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
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
