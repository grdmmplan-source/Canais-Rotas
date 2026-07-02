// debug-channels.js - INVESTIGACAO read-only
const { chromium } = require('playwright');

const OLOS_URL = 'https://ddm.oloschannel.com.br';
const LOGIN_URL = OLOS_URL + '/Olos/Login.aspx?logout=true';
const OLOS_USER = process.env.OLOS_USER;
const OLOS_PASS = process.env.OLOS_PASS;
const TARGET_ROUTE_NAME = process.env.TARGET_ROUTE_NAME || 'R1';
const SOURCE_ROUTE_NAME = process.env.SOURCE_ROUTE_NAME || 'NEWVOICE';

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
  await page.fill('#UserTxt', OLOS_USER);
  await page.fill('input[type="password"]', OLOS_PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('input[type="submit"]'),
  ]);
  console.log('Login OK. URL:', page.url());
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await login(page);

    // Entra no SysConfig via menu para estabelecer contexto de sessao
    const cfgLink = page.locator('a').filter({ hasText: /Configura/ }).first();
    await cfgLink.click();
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    console.log('SysConfig URL:', page.url());
    await page.screenshot({ path: 'debug-1.png', fullPage: true });

    // Clica Infraestrutura se existir no menu
    const infra = page.locator('a').filter({ hasText: 'Infraestrutura' });
    if (await infra.count() > 0) { await infra.first().click(); await page.waitForTimeout(400); }

    // Acha link Listar que aponte para Routes
    const href = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a'))
        .find(el => el.textContent.trim() === 'Listar' && (el.href||'').includes('Route'));
      return a ? a.href : null;
    });
    console.log('Routes Listar href:', href);
    if (!href) throw new Error('Link Listar de Rotas nao encontrado');

    await page.goto(href, { waitUntil: 'networkidle' });
    console.log('RoutesList URL:', page.url(), 'Titulo:', await page.title());
    await page.screenshot({ path: 'debug-2.png', fullPage: true });

    const selInfo = await page.evaluate((t) => {
      const s = document.querySelector('select');
      if (!s) return { found: false };
      const opts = Array.from(s.options).map(o => o.text);
      return { found: true, count: opts.length, sample: opts.slice(0,6), hasTarget: opts.some(x=>x.includes(t)) };
    }, TARGET_ROUTE_NAME);
    console.log('Select:', JSON.stringify(selInfo));
    if (!selInfo.found || !selInfo.hasTarget) throw new Error('Rota alvo nao encontrada no select');

    await page.locator('select').first().selectOption({ label: new RegExp(TARGET_ROUTE_NAME) });
    await page.click('input[value="Editar"], button:has-text("Editar")');
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    console.log('RoutesForm URL:', page.url());
    await page.screenshot({ path: 'debug-3.png', fullPage: true });

    await page.click('text=Canais');
    await page.waitForTimeout(500);
    await page.click('text=Configurar Canais');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    console.log('RoutesFormChannel URL:', page.url());
    await page.screenshot({ path: 'debug-4.png', fullPage: true });

    const state = await page.evaluate((src) => {
      const li = document.querySelector('li.route-item');
      if (!li) return { error: 'no li.route-item' };
      const scope = window.angular.element(li).scope().$parent;
      const sel = document.querySelector('select.channel-selection') || document.querySelector('select');
      const opts = sel ? Array.from(sel.options) : [];
      const fromSrc = opts.filter(o => o.label && o.label.includes('R: ' + src));
      return {
        routeName: scope.routeName,
        totalChannels: opts.length,
        channelsFromSource: fromSrc.length,
        sampleFromSource: fromSrc.slice(0,5).map(o => ({ value: o.value, label: o.label })),
        hasApplyFn: typeof scope.applyChannelChanges,
        hasSaveBtn: !!document.querySelector('button[ng-click="saveRouteChanges()"]'),
        olosRoutes: (scope.olosRoutes||[]).map(r => r.name+':'+r.count),
      };
    }, SOURCE_ROUTE_NAME);
    console.log('=== ESTADO ANGULAR ===');
    console.log(JSON.stringify(state, null, 2));

  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error('Erro fatal:', err.message); process.exit(1); });
