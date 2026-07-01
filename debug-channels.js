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
  console.log('Login realizado. URL:', page.url());
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await login(page);

    // Tenta navegar diretamente para RoutesList
    await page.goto(OLOS_URL + '/SysConfiguration/ChannelControl.aspx', { waitUntil: 'networkidle' });
    console.log('URL ChannelControl:', page.url(), '| Titulo:', await page.title());
    await page.screenshot({ path: 'debug-1.png', fullPage: true });

    // Loga todos links com Route no href
    const allLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a'))
        .map(a => ({ text: a.textContent.trim().slice(0, 60), href: a.getAttribute('href') }))
        .filter(l => l.href && l.href.includes('Route'))
    );
    console.log('Links Route:', JSON.stringify(allLinks));

    // Tenta URL direta de RoutesList
    await page.goto(OLOS_URL + '/SysConfiguration/RoutesList.aspx', { waitUntil: 'networkidle' });
    console.log('URL RoutesList:', page.url(), '| Titulo:', await page.title());
    await page.screenshot({ path: 'debug-2.png', fullPage: true });

    const selectInfo = await page.evaluate((target) => {
      const sel = document.querySelector('select');
      if (!sel) return { found: false };
      const opts = Array.from(sel.options).map(o => o.text);
      return { found: true, count: opts.length, sample: opts.slice(0, 8), hasTarget: opts.some(t => t.includes(target)) };
    }, TARGET_ROUTE_NAME);
    console.log('Select rotas:', JSON.stringify(selectInfo));

    if (!selectInfo.found || !selectInfo.hasTarget) {
      throw new Error('Nao encontrou rota alvo no select. Veja debug-2.png');
    }

    // Seleciona TARGET e clica Editar
    const sel = page.locator('select').first();
    await sel.selectOption({ label: new RegExp(TARGET_ROUTE_NAME) });
    await page.click('input[value="Editar"], button:has-text("Editar")');
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    console.log('URL RoutesForm:', page.url());
    await page.screenshot({ path: 'debug-3.png', fullPage: true });

    // Aba Canais -> Configurar Canais
    await page.click('text=Canais');
    await page.waitForTimeout(500);
    await page.click('text=Configurar Canais');
    await page.waitForLoadState('networkidle');
    console.log('URL RoutesFormChannel:', page.url());
    await page.screenshot({ path: 'debug-4.png', fullPage: true });

    // Le estado AngularJS (somente leitura)
    const state = await page.evaluate((src) => {
      const li = document.querySelector('li.route-item');
      if (!li) return { error: 'no li.route-item' };
      const scope = window.angular.element(li).scope().$parent;
      const sel = document.querySelector('select.channel-selection') || document.querySelector('select');
      const opts = sel ? Array.from(sel.options) : [];
      const fromSrc = opts.filter(o => o.label.includes('R: ' + src));
      return {
        routeName: scope.routeName,
        totalChannels: opts.length,
        channelsFromSource: fromSrc.length,
        sampleFromSource: fromSrc.slice(0, 5).map(o => ({ value: o.value, label: o.label })),
        hasApplyFn: typeof scope.applyChannelChanges,
        hasSaveBtn: !!document.querySelector('button[ng-click="saveRouteChanges()"]'),
      };
    }, SOURCE_ROUTE_NAME);
    console.log('=== ESTADO ANGULAR ===');
    console.log(JSON.stringify(state, null, 2));

  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error('Erro fatal:', err.message); process.exit(1); });
