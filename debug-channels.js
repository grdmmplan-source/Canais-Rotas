// debug-channels.js
// Script de INVESTIGACAO (read-only) - NAO clica em Aplicar/Salvar.
// Objetivo: confirmar o mecanismo real de atribuicao de canais por rota
// antes de implementar a automacao definitiva.

const { chromium } = require('playwright');

const OLOS_URL = 'https://ddm.oloschannel.com.br';
const LOGIN_URL = `${OLOS_URL}/Olos/Login.aspx?logout=true`;

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
          page.click('input[type="submit"], #btnOk, input[value="OK"]'),
        ]);
    console.log('Login realizado');
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
          await login(page);

          await page.goto(`${OLOS_URL}/SysConfiguration/ChannelControl.aspx`, { waitUntil: 'networkidle' });
          await page.click('text=Rotas');
          await page.waitForTimeout(300);
          await page.click('a:has-text("Listar")');
          await page.waitForNavigation({ waitUntil: 'networkidle' });
          console.log('Pagina RoutesList carregada:', page.url());

          const select = page.locator('select').filter({ hasText: TARGET_ROUTE_NAME }).first();
          await select.selectOption({ label: new RegExp(`^${TARGET_ROUTE_NAME}\\s*\\(`) });
          await page.click('text=Editar');
          await page.waitForNavigation({ waitUntil: 'networkidle' });
          console.log('Pagina RoutesForm carregada:', page.url());

          await page.click('text=Canais');
          await page.waitForTimeout(300);
          await page.click('text=Configurar Canais');
          await page.waitForTimeout(1000);
          console.log('Pagina RoutesFormChannel carregada:', page.url());

          const angularState = await page.evaluate((sourceRouteName) => {
                  const sel = document.querySelector('select.channel-selection');
                  const scope = window.angular ? window.angular.element(sel || document.querySelector('li.route-item')).scope() : null;
                          let parentScope = scope ? (scope.routeName !== undefined ? scope : scope.$parent) : null;

                  const result = {};
                  result.scopeRouteName = parentScope ? parentScope.routeName : 'NAO ENCONTRADO';
                  result.lastSelectedRouteName = parentScope ? parentScope.lastSelectedRouteName : null;

                  const options = sel ? Array.from(sel.options) : [];
                  const fromSource = options.filter(o => o.label.includes(`R: ${sourceRouteName}`));
                  result.totalChannelOptions = options.length;
                  result.channelsFromSourceRoute = fromSource.length;
                  result.sampleChannelsFromSource = fromSource.slice(0, 5).map(o => ({ value: o.value, label: o.label }));

                  result.hasApplyFn = parentScope ? typeof parentScope.applyChannelChanges : 'sem parentScope';
                  result.hasSalvarBtn = !!document.querySelector('button[ng-click="saveRouteChanges()"]');

                  return result;
          }, SOURCE_ROUTE_NAME);

          console.log('=== ESTADO ANGULAR (somente leitura) ===');
          console.log(JSON.stringify(angularState, null, 2));
    } finally {
          await browser.close();
    }
}

main().catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(1);
});
  
