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

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

  await page.locator('a').filter({ hasText: /Configura/ }).first().click();
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    log('SysConfig URL: ' + page.url());
    await page.screenshot({ path: 'debug-1.png', fullPage: true });

  const infra = page.locator('a').filter({ hasText: 'Infraestrutura' });
    if (await infra.count() > 0) {
      await infra.first().click();
      await page.waitForTimeout(400);
      log('Clicou Infraestrutura');
    } else {
      log('Infraestrutura nao encontrado no menu');
    }

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

  const btns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input[type=submit], input[type=button], button'))
                                   .map(b => ({ tag: b.tagName, type: b.type, value: b.value, text: b.textContent.trim().slice(0,30) }))
                                   );
    log('Botoes na pagina: ' + JSON.stringify(btns));

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

  const allSelects = await page.evaluate(() =>
    Array.from(document.querySelectorAll('select')).map((s, i) => ({
      index: i, id: s.id, name: s.name,
      count: s.options.length,
      sample: Array.from(s.options).slice(0, 5).map(o => o.text),
    }))
                                         );
    log('Selects apos Pesquisar: ' + JSON.stringify(allSelects));

  const targetPattern = '^' + escapeRegex(TARGET_ROUTE_NAME) + '\\s*\\(';
    const routesSelect = await page.evaluate((pattern) => {
      const re = new RegExp(pattern);
      const allSels = Array.from(document.querySelectorAll('select'));

                                             let s = allSels.find(sel => /listbox/i.test(sel.id));
      if (!s || !Array.from(s.options).some(o => re.test(o.text.trim()))) {
        s = allSels.find(sel => Array.from(sel.options).some(o => re.test(o.text.trim())));
      }
      if (!s) return { found: false };

                                             const opts = Array.from(s.options).map(o => o.text);
      return {
        found: true, id: s.id, count: opts.length,
        sample: opts.slice(0, 10),
        hasTarget: opts.some(x => re.test(x.trim())), matchedLabel: (opts.find(x => re.test(x.trim())) || '').trim() || null,
      };
    }, targetPattern);
    log('Select de rotas: ' + JSON.stringify(routesSelect));

  if (!routesSelect.found || !routesSelect.hasTarget) {
    throw new Error('Rota alvo nao encontrada no select. Selects: ' + JSON.stringify(allSelects));
  }

  await page.locator('select#' + routesSelect.id).selectOption({ label: routesSelect.matchedLabel });
    await page.waitForTimeout(500);

  const editBtn = page.locator('input[value="Editar"]').first();
    await editBtn.click();
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    log('RoutesForm URL: ' + page.url());
    await page.screenshot({ path: 'debug-3.png', fullPage: true });

  await page.click('text=Canais');
    await page.waitForTimeout(500);
    const tabLinks = await page.evaluate(() => Array.from(document.querySelectorAll('a, li, span, div')).map(el => (el.textContent||'').trim()).filter(t => t && t.length < 40 && /canal|canai/i.test(t))); log('Textos com canal: ' + JSON.stringify([...new Set(tabLinks)])); await page.screenshot({ path: 'debug-3b.png', fullPage: true }); await page.click('text=Controle de Canais');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    log('RoutesFormChannel URL: ' + page.url());
    await page.screenshot({ path: 'debug-4.png', fullPage: true });

  const state = await page.evaluate((src) => {
    const ngRepeatEls = Array.from(document.querySelectorAll('[ng-repeat]')).map(el => el.getAttribute('ng-repeat')); const selects = Array.from(document.querySelectorAll('select')).map(s => ({ id: s.id, cls: s.className, count: s.options.length })); const classesWithRoute = Array.from(document.querySelectorAll('[class*="route"], [class*="channel"]')).slice(0,20).map(el => ({ tag: el.tagName, cls: el.className })); return { title: document.title, hasAngular: typeof window.angular !== 'undefined', ngRepeatEls: [...new Set(ngRepeatEls)], selects, classesWithRoute, bodyTextSample: document.body.innerText.slice(0, 300) };
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
