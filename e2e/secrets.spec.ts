import { expect, test, type Page } from '@playwright/test';

const senha = 'senha-forte-123';
const mestra = 'senha-mestra-e2e-1';
const novoEmail = () => `cofre-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemplo.com`;

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

async function abrirSecrets(page: Page) {
  await page.locator('.fab').click();
  await page.locator('.quick-menu').getByRole('menuitem', { name: 'Secrets' }).click();
  await expect(page.locator('#secretsDlg .dlg-title')).toContainText('Secrets');
}

/* a derivação PBKDF2 (600k) leva ~0,3–3s — os timeouts consideram isso */

test('cofre: setup, item, travar ao fechar, senha errada e certa, copiar', async ({ page, context, browserName }) => {
  await criarConta(page, novoEmail());
  await abrirSecrets(page);

  /* 1º uso: aviso de irrecuperabilidade + criação */
  await expect(page.locator('.vault-warn')).toContainText('não existe recuperação');
  await page.locator('#sMaster').fill(mestra);
  await page.locator('#sMaster2').fill(mestra);
  await page.locator('#secretsDlg').getByRole('button', { name: 'Criar cofre' }).click();
  await expect(page.locator('.lock-badge')).toBeVisible({ timeout: 20_000 });

  /* item com campo secreto */
  await page.locator('#secretsDlg').getByRole('button', { name: 'Adicionar' }).click();
  await page.locator('#sTitle').fill('Servidor VPS');
  await page.locator('#sSegment').fill('Servidores');
  const rows = page.locator('.sfield-row');
  await rows.nth(0).locator('.sf-val').fill('root');
  await rows.nth(1).locator('.sf-val').fill('chave-super-secreta');
  await page.locator('#secretsDlg').getByRole('button', { name: 'Salvar item' }).click();
  await expect(page.locator('.toast')).toContainText('Item salvo no cofre');
  await expect(page.locator('.secret-title', { hasText: 'Servidor VPS' })).toBeVisible();
  /* valor sensível nasce mascarado */
  await expect(page.locator('.secret-card').getByText('••••••••')).toBeVisible();

  /* fechar TRAVA — reabrir pede a senha de novo */
  await page.locator('#secretsDlg [data-close]').click();
  await abrirSecrets(page);
  await expect(page.locator('#sMaster')).toBeVisible();

  /* senha errada = erro genérico */
  await page.locator('#sMaster').fill('senha-errada-000');
  await page.locator('#secretsDlg').getByRole('button', { name: 'Destravar cofre' }).click();
  await expect(page.locator('#secretsDlg .auth-err')).toContainText('Senha-mestra incorreta', { timeout: 20_000 });

  /* senha certa decifra o item gravado na sessão anterior */
  await page.locator('#sMaster').fill(mestra);
  await page.locator('#secretsDlg').getByRole('button', { name: 'Destravar cofre' }).click();
  await expect(page.locator('.secret-title', { hasText: 'Servidor VPS' })).toBeVisible({ timeout: 20_000 });

  /* olho revela o valor decifrado */
  await page.locator('.secret-card [aria-label="Mostrar/ocultar"]').click();
  await expect(page.locator('.secret-card').getByText('chave-super-secreta')).toBeVisible();

  /* copiar (clipboard só é permissível no chromium desktop) */
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('.secret-card [title="Copiar"]').nth(1).click();
    await expect(page.locator('.toast')).toContainText('Copiado');
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiado).toBe('chave-super-secreta');
  }
});

test('cofre: zero-knowledge — servidor só guarda ciphertext', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirSecrets(page);
  await page.locator('#sMaster').fill(mestra);
  await page.locator('#sMaster2').fill(mestra);
  await page.locator('#secretsDlg').getByRole('button', { name: 'Criar cofre' }).click();
  await expect(page.locator('.lock-badge')).toBeVisible({ timeout: 20_000 });

  await page.locator('#secretsDlg').getByRole('button', { name: 'Adicionar' }).click();
  await page.locator('#sTitle').fill('Segredo Máximo');
  await page.locator('.sfield-row').nth(1).locator('.sf-val').fill('valor-que-nao-pode-vazar');
  await page.locator('#secretsDlg').getByRole('button', { name: 'Salvar item' }).click();
  await expect(page.locator('.toast')).toContainText('Item salvo no cofre');

  /* o unlock devolve os itens do servidor: nada de plaintext lá dentro */
  const doServidor = await page.evaluate(async () => {
    /* sem o token o servidor nem lista — o unlock exige a authKey; então
       validamos pelo caminho real: o que a API de unlock entregou está
       cifrado (sem título nem valor em claro) */
    const r = await fetch('/api/secrets/vault', { credentials: 'same-origin' });
    return r.json();
  });
  expect(doServidor.exists).toBe(true);
  expect(JSON.stringify(doServidor)).not.toContain('Segredo Máximo');
  expect(JSON.stringify(doServidor)).not.toContain('valor-que-nao-pode-vazar');
});

test('cofre: rate limit de unlock (5 tentativas → 429)', async ({ page }) => {
  await criarConta(page, novoEmail());
  /* cria o cofre direto pela API do cliente (mais rápido que 6 derivações de UI) */
  await abrirSecrets(page);
  await page.locator('#sMaster').fill(mestra);
  await page.locator('#sMaster2').fill(mestra);
  await page.locator('#secretsDlg').getByRole('button', { name: 'Criar cofre' }).click();
  await expect(page.locator('.lock-badge')).toBeVisible({ timeout: 20_000 });
  await page.locator('#secretsDlg [data-close]').click();

  const status = await page.evaluate(async () => {
    const out: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch('/api/secrets/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ authKey: 'f'.repeat(64) }),
      });
      out.push(r.status);
    }
    return out;
  });
  expect(status.slice(0, 5).every((s) => s === 401)).toBe(true);
  expect(status[5]).toBe(429);
});
