import { expect, test, type Page } from '@playwright/test';

const senha = 'senha-forte-123';
const novoEmail = () => `reset-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemplo.com`;

async function criarConta(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.locator('#aEmail').fill(email);
  await page.locator('#aPass').fill(senha);
  await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
  await expect(page.locator('.views')).toBeVisible();
}

async function sair(page: Page) {
  await page.locator('.avatar').click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page.getByRole('tab', { name: 'Entrar' })).toBeVisible();
}

/* pede o link de recuperação pela UI e captura o devLink da resposta real */
async function pedirLink(page: Page, email: string): Promise<string> {
  await page.locator('#aForgot').click();
  await page.locator('#fEmail').fill(email);
  const resp = page.waitForResponse((r) => r.url().includes('/api/auth/forgot') && r.ok());
  await page.getByRole('button', { name: 'Enviar link' }).click();
  const { devLink } = await (await resp).json();
  expect(devLink).toBeTruthy();
  await expect(page.locator('.auth-ok')).toBeVisible();
  return devLink as string;
}

test('recupera a senha pelo "esqueci minha senha" (fluxo completo)', async ({ page }) => {
  const email = novoEmail();
  const novaSenha = 'senha-nova-789';
  await criarConta(page, email);
  await page.waitForTimeout(1500);
  await sair(page);

  const devLink = await pedirLink(page, email);
  await page.goto(devLink);
  await page.locator('#rPass').fill(novaSenha);
  await page.locator('#rPass2').fill(novaSenha);
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.locator('.views')).toBeVisible(); // auto-login
  await sair(page);

  // senha antiga recusada, nova aceita
  await page.locator('#aEmail').fill(email);
  await page.locator('#aPass').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('.auth-err')).toContainText('incorretos');
  await page.locator('#aPass').fill(novaSenha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('.views')).toBeVisible();
});

test('link de recuperação é de uso único', async ({ page }) => {
  const email = novoEmail();
  await criarConta(page, email);
  await page.waitForTimeout(1200);
  await sair(page);
  const devLink = await pedirLink(page, email);

  await page.goto(devLink);
  await page.locator('#rPass').fill('outra-senha-456');
  await page.locator('#rPass2').fill('outra-senha-456');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.locator('.views')).toBeVisible();

  // reusar o mesmo link deve falhar
  await page.goto(devLink);
  await page.locator('#rPass').fill('terceira-senha-000');
  await page.locator('#rPass2').fill('terceira-senha-000');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.locator('.auth-err')).toContainText('inválido ou expirado');
});

test('forgot tem rate limit por e-mail (3 por janela)', async ({ page }) => {
  await page.goto('/');
  const email = novoEmail(); // nem precisa existir — o limite conta requisições
  for (let i = 0; i < 3; i++) {
    const r = await page.request.post('/api/auth/forgot', { data: { email } });
    expect(r.status()).toBe(200);
  }
  const r4 = await page.request.post('/api/auth/forgot', { data: { email } });
  expect(r4.status()).toBe(429);
});

test('botão do Google presente e desabilitado sem configuração', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#aGoogle')).toBeVisible();
  await expect(page.locator('#aGoogle')).toBeDisabled();
});
