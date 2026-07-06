// debug-channels.js - INVESTIGACAO read-only
const { chromium } = require('playwright');
const fs = require('fs');

const OLOS_URL = 'https://ddm.oloschannel.com.br';
const LOGIN_URL = OLOS_URL + '/Olos/Login.aspx?logout=true';
const OLOS_USER = process.env.OLOS_USER;
const OLOS_PASS = process.env.OLOS_PASS;
const TARGET_ROUTE_NAME = process.env.TARGET_ROUTE_NAME || 'R1';
const SOURCE_ROUTE_NAME = process.env.SOURCE_ROUTE_NAME || 'NEWVOICE';

const log = (msg) => {
  console.log(msg);
  fs.appendFileSync('resultado.txt', msg + '\n');
};

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
  await page.fill('#UserTxt', OLOS_USER);
  await page.fill('input[type="password"]', OLOS_PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('input[type="submit"]'),
  ]);
  log('Login OK. URL: ' + page.url());
}

async function main() {
  fs.writeFileSync('resultado.txt', '=== DEBUG CHANNELS ===\n');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await login(page);

    // Entra no SysConfig via menu
    await page.locator('a').filter({ hasText: /Configura/ }).first().click();
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    log('SysConfig URL: ' + page.url());
    await page.screenshot({ path: 'debug-1.png', fullPage: true });

    // Clica Infraestrutura se existir
    const infra = page.locator('a').filter({ hasText: 'Infraestrutura' });
    if (await infra.count() > 0) {
      await infra.first().click();
      await page.waitForTimeout(400);
      log('Clicou Infraestrutura');
    } else {
      log('Infraestrutura nao encontrado no menu');
    }

    // Acha o link Listar de Rotas
    const href = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a'))
        .find(el => el.textContent.trim() === 'Listar' && (el.href || '').includes('Route'));
      return a ? a.href : null;
    });
    log('Routes Listar href: ' + href);
    if (!href) throw new Error('Link Listar de Rotas nao encontrado');

    await page.goto(href, { waitUntil: 'networkidle' });
    log('RoutesList URL: ' + page.url() + ' | Titulo: ' + await page.title());
    await page.screenshot({ path: 'debug-2-before-search.png', fullPage: true });

    // Loga botoes e inputs disponiveis antes de pesquisar
    const btns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input[type=submit], input[type=button], button'))
        .map(b => ({ tag: b.tagName, type: b.type, value: b.value, text: b.textContent.trim().slice(0,30) }))
    );
    log('Botoes na pagina: ' + JSON.stringify(btns));

    // Clica Pesquisar para carregar a lista de rotas
    try {
      const searchBtn = page.locator('input[value="Pesquisar"]').first();
      if (await searchBtn.count() > 0) {
        await searchBtn.click();
        log('Clicou Pesquisar (input[value])');
      } else {
        await page.click('text=Pesquisar');
        log('Clicou Pesquisar (text)');
      }
      await page.waitForTimeout(1000);
    } catch(e) {
      log('AVISO Pesquisar: ' + e.message);
    }
    await page.screenshot({ path: 'debug-2-after-search.png', fullPage: true });

    // Loga todos os selects
    const allSelects = await page.evaluate(() =>
      Array.from(document.querySelectorAll('select')).map((s, i) => ({
        index: i, id: s.id, name: s.name,
        count: s.options.length,
        sample: Array.from(s.options).slice(0, 5).map(o => o.text),
      }))
    );
    log('Selects apos Pesquisar: ' + JSON.stringify(allSelects));

    // Pega o select com mais opcoes
    const routesSelect = await page.evaluate((target) => {
      const allSels = Array.from(document.querySelectorAll('select'));
      const s = allSels.reduce((best, cur) => cur.options.length > best.options.length ? cur : best, allSels[0]);
      if (!s) return { found: false };
      const opts = Array.from(s.options).map(o => o.text);
      return {
        found: true, id: s.id, count: opts.length,
        sample: opts.slice(0, 10),
        hasTarget: opts.some(x => x.includes(target)),
      };
    }, TARGET_ROUTE_NAME);
    log('Select de rotas: ' + JSON.stringify(routesSelect));

    if (!routesSelect.found || !routesSelect.hasTarget) {
      throw new Error('Rota alvo nao encontrada no select. Selects: ' + JSON.stringify(allSelects));
    }

    // Seleciona rota alvo e clica Editar
    await page.locator('select#' + routesSelect.id).selectOption({ label: new RegExp(TARGET_ROUTE_NAME) });
    const editBtn = page.locator('input[value="Editar"]').first();
    await editBtn.click();
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    log('RoutesForm URL: ' + page.url());
    await page.screenshot({ path: 'debug-3.png', fullPage: true });

    // Aba Canais -> Configurar Canais
    await page.click('text=Canais');
    await page.waitForTimeout(500);
    await page.click('text=Configurar Canais');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    log('RoutesFormChannel URL: ' + page.url());
    await page.screenshot({ path: 'debug-4.png', fullPage: true });

    // Le estado Angular (somente leitura)
    const state = await page.evaluate((src) => {
      const li = document.querySelector('li.route-item');
      if (!li) return { error: 'no li.route-item found' };
      const scope = window.angular.element(li).scope().$parent;
      const sel = document.querySelector('select.channel-selection') || document.querySelector('select');
      const opts = sel ? Array.from(sel.options) : [];
      const fromSrc = opts.filter(o => o.label && o.label.includes('R: ' + src));
      return {
        routeName: scope.routeName,
        totalChannels: opts.length,
        channelsFromSource: fromSrc.length,
        sampleFromSource: fromSrc.slice(0, 5).map(o => ({ value: o.value, label: o.label })),
        hasApplyFn: typeof scope.applyChannelChanges,
        hasSaveBtn: !!document.querySelector('button[ng-click="saveRouteChanges()"]'),
        olosRoutes: (scope.olosRoutes || []).map(r => r.name + ':' + r.count),
      };
    }, SOURCE_ROUTE_NAME);
    log('=== ESTADO ANGULAR ===');
    log(JSON.stringify(state, null, 2));

  } finally {
    await browser.close();
  }
}

main().catch(err => {
  log('Erro fatal: ' + err.message);
  process.exit(1);
});
