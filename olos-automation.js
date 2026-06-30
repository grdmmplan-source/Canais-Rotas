// olos-automation.js
// Script Playwright que aplica mudancas pendentes no sistema Olos
// Recebe as mudancas via variavel de ambiente CHANGES_JSON (array de objetos)
// Formato de cada mudanca:
//   { campanha: "AD_VAPI", campaignId: 105, campo: "aloc"|"rota"|"max", valor: "10"|"NEWVOICE" }

const { chromium } = require('playwright');

const OLOS_URL = 'https://ddm.oloschannel.com.br';
const LOGIN_URL = `${OLOS_URL}/Olos/Login.aspx?logout=true`;
const CHANNEL_CONTROL_URL = `${OLOS_URL}/SysConfiguration/ChannelControl.aspx`;
const CAMPAIGNS_LIST_URL = `${OLOS_URL}/SysConfiguration/CampaignsList.aspx`;

const OLOS_USER = process.env.OLOS_USER;
const OLOS_PASS = process.env.OLOS_PASS;

const ROUTE_ID_MAP = {
  PONTALTECH: '2015',
  VONEX: '2013',
  NEWVOICE: '2017',
  NEWVOICE_BM: '2027',
  R1: '2032',
  OKTOR_ALTA: '2034',
  GOSAT: '2035',
  VAPI: '2031',
  RETELL: '2033',
  SIPWAY: '2019',
  '4NET': '2037',
  OKTOR: '2034',
};

const IGNORE_CAMPAIGNS = new Set([
  'ADA_Template_Cobranca',
  'ADA_Template_Vendas',
  'Locator_CPF_Template',
  'Locator_Template',
  'LICENCAS',
  'IA DDM',
  'SIP',
]);

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

async function editAlocado(page, campanha, novoValor) {
  await page.goto(CHANNEL_CONTROL_URL, { waitUntil: 'networkidle' });

  const row = page.locator('tr', { has: page.locator(`td:text-is("${campanha}")`) });
  const count = await row.count();
  if (count === 0) {
    throw new Error(`Campanha "${campanha}" nao encontrada na tela de Controle de Canais`);
  }

  await row.locator('.edit_cell.edit').click();
  await page.waitForTimeout(500);

  const allocCell = row.locator('td[contenteditable="true"]');
  await allocCell.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(String(novoValor));
  await page.waitForTimeout(300);

  await row.locator('.edit_cell.save').click();
  await page.waitForTimeout(1000);
  console.log(`${campanha}: Alocado atualizado para ${novoValor}`);
}

async function openCampaignEdit(page, campaignId) {
  await page.goto(CAMPAIGNS_LIST_URL, { waitUntil: 'networkidle' });

  const select = page.locator('select').filter({ has: page.locator(`option[value="${campaignId}"]`) }).first();
  await select.selectOption(String(campaignId));

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('#ctl00_PageContent__Edit'),
  ]);
}

async function editRota(page, campanha, campaignId, novaRotaNome) {
  const routeId = ROUTE_ID_MAP[novaRotaNome];
  if (!routeId) {
    throw new Error(`Rota "${novaRotaNome}" nao tem ID mapeado para RouteConsultId`);
  }

  await openCampaignEdit(page, campaignId);
  await page.click('text=Rota');
  await page.waitForTimeout(500);

  await page.selectOption(
    '#ctl00_PageContent_TabContainer1_TabPanelRoute_RouteConsultId',
    routeId
  );

  await page.click('#ctl00_PageContent_ButtonEditCampaign');
  await page.waitForTimeout(1000);
  console.log(`${campanha}: Rota atualizada para ${novaRotaNome}`);
}

async function editMaxCanais(page, campanha, campaignId, novoValor) {
  await openCampaignEdit(page, campaignId);
  await page.click('text=Metas');
  await page.waitForTimeout(500);

  await page.fill(
    '#ctl00_PageContent_TabContainer1_TabPanelTargets_Channels',
    String(novoValor)
  );

  await page.click('#ctl00_PageContent_ButtonEditCampaign');
  await page.waitForTimeout(1000);
  console.log(`${campanha}: Max. Canais atualizado para ${novoValor}`);
}

async function main() {
  const changesRaw = process.env.CHANGES_JSON;
  if (!changesRaw) {
    console.error('CHANGES_JSON nao definido. Nada a fazer.');
    process.exit(1);
  }

  let changes;
  try {
    changes = JSON.parse(changesRaw);
  } catch (e) {
    console.error('CHANGES_JSON invalido:', e.message);
    process.exit(1);
  }

  if (!Array.isArray(changes) || changes.length === 0) {
    console.log('Nenhuma mudanca pendente. Encerrando.');
    return;
  }

  const validChanges = changes.filter((c) => !IGNORE_CAMPAIGNS.has(c.campanha));
  const skipped = changes.filter((c) => IGNORE_CAMPAIGNS.has(c.campanha));
  skipped.forEach((c) =>
    console.log(`Ignorando "${c.campanha}" - campanha nao existe no Olos (controle interno do app)`)
  );

  if (validChanges.length === 0) {
    console.log('Todas as mudancas eram de campanhas ignoradas. Encerrando.');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const results = [];

  try {
    await login(page);

    for (const change of validChanges) {
      const { campanha, campaignId, campo, valor } = change;
      try {
        if (campo === 'aloc') {
          await editAlocado(page, campanha, valor);
        } else if (campo === 'rota') {
          await editRota(page, campanha, campaignId, valor);
        } else if (campo === 'max') {
          await editMaxCanais(page, campanha, campaignId, valor);
        } else if (campo === 'sol') {
          console.log(`${campanha}: campo "sol" nao tem acao direta no Olos - pulando`);
          continue;
        } else {
          console.log(`${campanha}: campo "${campo}" nao reconhecido - pulando`);
          continue;
        }
        results.push({ ...change, status: 'ok' });
      } catch (err) {
        console.error(`Erro ao aplicar mudanca em "${campanha}":`, err.message);
        results.push({ ...change, status: 'erro', erro: err.message });
      }
    }
  } finally {
    await browser.close();
  }

  console.log('=== RESUMO ===');
  console.log(JSON.stringify(results, null, 2));

  const erros = results.filter((r) => r.status === 'erro');
  if (erros.length > 0) {
    console.error(`${erros.length} mudanca(s) falharam.`);
    process.exit(1);
  }
  console.log(`Todas as ${results.length} mudancas foram aplicadas com sucesso.`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
