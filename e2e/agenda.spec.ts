import { expect, test, type Locator, type Page } from '@playwright/test';

const senha = 'senha-forte-123';
const novoEmail = () => `teste-${Date.now()}-${Math.floor(Math.random() * 1e6)}@exemplo.com`;

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

/* o logout fica no menu do perfil (avatar no topo), em qualquer viewport */
async function sair(page: Page) {
  await page.locator('.avatar').click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page.getByRole('tab', { name: 'Entrar' })).toBeVisible();
}

/* o .fab abre o menu de acesso rápido (mobile: botão redondo; web: aba lateral
   recolhida — o clique já expande). Escolher o item pelo NOME: a ordem no DOM
   difere entre as variantes (na web "Nova tarefa" fica no meio). */
async function abrirNovaTarefa(page: Page) {
  await page.locator('.fab').click();
  await page.locator('.quick-menu').getByRole('menuitem', { name: 'Nova tarefa' }).click();
  await expect(page.locator('#tTitle')).toBeVisible();
}

test('cria conta, entra e vê as tarefas de exemplo', async ({ page }) => {
  const email = novoEmail();
  await criarConta(page, email);
  // tarefas de exemplo semeadas na primeira entrada
  await expect(page.locator('.pill-title', { hasText: 'Planejar o trimestre' }).first()).toBeAttached();
  // o app abre na visão de trimestre
  await expect(page.locator('.view-tab[data-view="trimestre"]')).toHaveAttribute('aria-selected', 'true');
});

test('sai e entra de novo com a mesma conta', async ({ page }) => {
  const email = novoEmail();
  await criarConta(page, email);
  await page.waitForTimeout(1500); // espera o auto-save da primeira entrada
  await sair(page);
  await page.locator('#aEmail').fill(email);
  await page.locator('#aPass').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('.views')).toBeVisible();
});

test('cria uma tarefa e ela persiste após recarregar', async ({ page }) => {
  const email = novoEmail();
  await criarConta(page, email);
  await abrirNovaTarefa(page);
  await page.locator('#tTitle').fill('Comprar café especial');
  await page.getByRole('button', { name: 'Salvar tarefa' }).click();
  await expect(page.locator('.toast')).toContainText('Tarefa criada');
  await expect(page.locator('.pill-title', { hasText: 'Comprar café especial' }).first()).toBeAttached();
  // espera o debounce do auto-save gravar no banco
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator('.views')).toBeVisible();
  await expect(page.locator('.pill-title', { hasText: 'Comprar café especial' }).first()).toBeAttached();
});

test('troca a senha nas configurações e entra com a nova', async ({ page }) => {
  const email = novoEmail();
  const novaSenha = 'nova-senha-456';
  await criarConta(page, email);
  await page.locator('.avatar').click();
  await page.getByRole('menuitem', { name: 'Configurações' }).click();
  await page.locator('#cfgCur').fill(senha);
  await page.locator('#cfgNew').fill(novaSenha);
  await page.locator('#cfgNew2').fill(novaSenha);
  await page.getByRole('button', { name: 'Alterar senha' }).click();
  await expect(page.locator('.toast')).toContainText('Senha alterada');
  await page.locator('.overlay.open [data-close]').first().click();
  // sai pelo menu do perfil e entra com a senha nova
  await page.locator('.avatar').click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page.getByRole('tab', { name: 'Entrar' })).toBeVisible();
  await page.locator('#aEmail').fill(email);
  await page.locator('#aPass').fill(novaSenha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('.views')).toBeVisible();
});

test('botões de ditado por voz aparecem no editor de tarefa', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaTarefa(page);
  // um microfone no título e outro nas anotações
  await expect(page.locator('.dict-btn')).toHaveCount(2);
});

test('permite até 4 etiquetas por tarefa', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaTarefa(page);
  const opts = page.locator('.overlay.open .catopt').filter({ hasNotText: 'Nova' });
  // tarefa nova começa sem etiqueta — nada pré-selecionado
  await expect(page.locator('.overlay.open .catopt[aria-pressed="true"]')).toHaveCount(0);
  await opts.nth(0).click();
  await opts.nth(1).click();
  await opts.nth(2).click();
  await opts.nth(3).click();
  await expect(page.locator('.overlay.open .catopt[aria-pressed="true"]')).toHaveCount(4);
  // a quinta é recusada com aviso
  await opts.nth(4).click();
  await expect(page.locator('.toast')).toContainText('Máximo de 4');
  await expect(page.locator('.overlay.open .catopt[aria-pressed="true"]')).toHaveCount(4);
  // salva e a pílula mostra os 4 ícones de etiqueta
  await page.locator('#tTitle').fill('Tarefa com quatro etiquetas');
  await page.getByRole('button', { name: 'Salvar tarefa' }).click();
  const pill = page.locator('#side .pill', { hasText: 'Tarefa com quatro etiquetas' }).first();
  await expect(pill.locator('.catic')).toHaveCount(4);
});

test('senha errada é recusada', async ({ page }) => {
  const email = novoEmail();
  await criarConta(page, email);
  await page.waitForTimeout(800);
  await sair(page);
  await page.locator('#aEmail').fill(email);
  await page.locator('#aPass').fill('senha-errada-999');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('.auth-err')).toContainText('incorretos');
});

test('registro exige senhas iguais e volta ao login sem entrar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.locator('#aEmail').fill(novoEmail());
  await page.locator('#aPass').fill(senha);
  await page.locator('#aPass2').fill('outra-senha-123');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.locator('.auth-err')).toContainText('não conferem');

  /* corrige → conta criada, volta ao LOGIN (sem entrar) com banner */
  await page.locator('#aPass2').fill(senha);
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.locator('.auth-ok')).toContainText('Conta criada');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await expect(page.locator('.views')).not.toBeVisible();
});

/* no mobile a folha (#side) abre recolhida (peek) e itens dela — pills, rodapé
   com "Apagar tudo" — ficam fora do viewport; expandir por gesto é flaky em
   teste, então quando há grip (mobile) o clique é disparado via DOM. O que os
   testes validam é o fluxo APÓS o clique; o clique real é coberto no desktop. */
async function clicarNaFolha(page: Page, alvo: Locator) {
  if (await page.locator('#grip').isVisible().catch(() => false)) {
    /* pills abrem no motor de drag&drop (pointerdown→pointerup sem movimento),
       botões comuns no click — dispara os três; os que não se aplicam são inertes */
    await alvo.evaluate((el) => {
      const o: PointerEventInit = { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new PointerEvent('pointerup', o));
      (el as HTMLElement).click();
    });
  } else {
    await alvo.click();
  }
}

test('Apagar tudo exige a senha da conta', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaTarefa(page);
  await page.locator('#tTitle').fill('Tarefa que vai sumir');
  await page.getByRole('button', { name: 'Salvar tarefa' }).click();

  await clicarNaFolha(page, page.getByRole('button', { name: 'Apagar tudo' }));
  await expect(page.locator('#confirmDlg #cfPass')).toBeVisible();

  /* senha errada → erro inline, modal continua aberto */
  await page.locator('#cfPass').fill('senha-errada-999');
  await page.locator('#cfOk').click();
  await expect(page.locator('#confirmDlg .auth-err')).toContainText('incorreta');

  /* senha certa → apaga */
  await page.locator('#cfPass').fill(senha);
  await page.locator('#cfOk').click();
  await expect(page.locator('.toast')).toContainText('Tudo apagado');
  await expect(page.locator('.pill-title', { hasText: 'Tarefa que vai sumir' })).toHaveCount(0);
});

test('excluir tarefa pede confirmação', async ({ page }) => {
  await criarConta(page, novoEmail());
  await abrirNovaTarefa(page);
  await page.locator('#tTitle').fill('Tarefa protegida');
  await page.getByRole('button', { name: 'Salvar tarefa' }).click();
  await page.waitForTimeout(800);

  await clicarNaFolha(page, page.locator('#side .pill-title', { hasText: 'Tarefa protegida' }).first());
  await page.locator('.overlay.open [aria-label="Excluir tarefa"]').click();
  await expect(page.locator('#confirmDlg')).toHaveClass(/open/);

  /* cancelar mantém a tarefa */
  await page.locator('#confirmDlg').getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.locator('#side .pill-title', { hasText: 'Tarefa protegida' }).first()).toBeVisible();

  /* confirmar exclui */
  await page.locator('.overlay.open [aria-label="Excluir tarefa"]').click();
  await page.locator('#confirmDlg').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.locator('.toast')).toContainText('foi excluída');
});
