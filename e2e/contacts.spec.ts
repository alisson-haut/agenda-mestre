import { expect, test, type Page } from '@playwright/test';

const senha = 'senha-forte-123';
const novoEmail = () => `contato-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemplo.com`;

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

async function abrirContatos(page: Page) {
  await page.locator('.fab').click();
  await page.locator('.quick-menu').getByRole('menuitem', { name: 'Contatos' }).click();
  await expect(page.locator('#contactsDlg .dlg-title')).toContainText('Contatos');
}

test('cria, edita e exclui um contato', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirContatos(page);

  await page.locator('#contactsDlg').getByRole('button', { name: 'Novo contato' }).click();
  await page.locator('#ctName').fill('Maria Silva');
  await page.locator('#ctPhone').fill('+55 11 91234-5678');
  await page.locator('#ctEmail').fill('maria@exemplo.com');
  await page.locator('#ctCompany').fill('Acme');
  await page.locator('#contactsDlg').getByRole('button', { name: 'Salvar contato' }).click();
  await expect(page.locator('.toast')).toContainText('Contato criado');
  await expect(page.locator('.contact-name', { hasText: 'Maria Silva' })).toBeVisible();

  /* editar */
  await page.locator('.contact-row', { hasText: 'Maria Silva' }).click();
  await page.locator('#ctCompany').fill('Acme Brasil');
  await page.locator('#contactsDlg').getByRole('button', { name: 'Salvar contato' }).click();
  await expect(page.locator('.contact-name', { hasText: 'Acme Brasil' })).toBeVisible();

  /* excluir (confirmação via ConfirmModal) */
  await page.locator('.contact-row', { hasText: 'Maria Silva' }).click();
  await page.locator('#contactsDlg [aria-label="Excluir contato"]').click();
  await page.locator('#confirmDlg').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.locator('.toast')).toContainText('Contato excluído');
});

test('modelo CSV baixa e o import cria contatos', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirContatos(page);

  /* o botão discreto baixa o modelo padrão */
  const dlP = page.waitForEvent('download');
  await page.locator('#contactsDlg').getByRole('link', { name: 'baixar modelo' }).click();
  const dl = await dlP;
  expect(dl.suggestedFilename()).toBe('contatos-modelo.csv');

  /* importa um CSV no formato do modelo (com aspas e linha inválida) */
  const csv =
    'nome;telefone;email;empresa;observacoes\n' +
    'Bruno Costa;+55 21 98888-7777;bruno@exemplo.com;Beta Ltda;VIP\n' +
    '"Souza, Ana";;ana@exemplo.com;;\n' +
    ';;sem-nome@exemplo.com;;\n';
  await page.locator('#contactsDlg input[type="file"]').setInputFiles({
    name: 'contatos.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await expect(page.locator('.toast')).toContainText('2 contato(s) importado(s)');
  await expect(page.locator('.contact-name', { hasText: 'Bruno Costa' })).toBeVisible();
  await expect(page.locator('.contact-name', { hasText: 'Souza, Ana' })).toBeVisible();
});

test('nota vincula contato salvo', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirContatos(page);
  await page.locator('#contactsDlg').getByRole('button', { name: 'Novo contato' }).click();
  await page.locator('#ctName').fill('Dr. Lima');
  await page.locator('#contactsDlg').getByRole('button', { name: 'Salvar contato' }).click();
  await expect(page.locator('.toast')).toContainText('Contato criado');
  await page.locator('#contactsDlg [data-close]').click();

  await page.locator('.fab').click();
  await page.locator('.quick-menu').getByRole('menuitem', { name: 'Nova nota' }).click();
  await page.locator('#nTitle').fill('Reunião com o doutor');
  await page.locator('#noteDlg').getByRole('button', { name: 'Vincular' }).click();
  await page.locator('.cpick-opt', { hasText: 'Dr. Lima' }).click();
  await expect(page.locator('.cpick-chip', { hasText: 'Dr. Lima' })).toBeVisible();
  await page.locator('#noteDlg').getByRole('button', { name: 'Salvar nota' }).click();
  await expect(page.locator('.toast')).toContainText('Nota criada');
});
