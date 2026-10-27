/* Teste de desenvolvimento em Chrome/Edge headless, com perfil temporário e carteira fictícia. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const published = path.join(root, 'public');
const browserPath = process.env.ROYAL_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(file => fs.existsSync(file));
async function main() {
  if (!browserPath) throw Error('Informe ROYAL_TEST_BROWSER com um navegador Chromium para o teste.');
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const relative = pathname.startsWith('/Royal-Wallet/') ? pathname.slice('/Royal-Wallet/'.length) || 'index.html' : null;
    const file = relative && path.resolve(published, relative);
    if (!file || !file.startsWith(published + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://localhost:${server.address().port}/Royal-Wallet/`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true, chromiumSandbox: true,
      ignoreDefaultArgs: ['--unsafely-disable-devtools-self-xss-warnings'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // O teste local não precisa fazer qualquer chamada ao Firebase ou à internet.
    await context.route('https://**', route => route.abort());
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.policyViolations = [];
      document.addEventListener('securitypolicyviolation', event => window.policyViolations.push(event.violatedDirective));
    });
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.locator('#btnContinuarLocal').click();
    await page.locator('#vaultPassword').fill('senha ficticia longa do teste');
    await page.locator('#vaultConfirm').fill('senha ficticia longa do teste');
    await page.getByRole('button', { name: 'Criar proteção', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('vaultRecoveryOutput')?.value.startsWith('RW1-'));
    assert.equal(await page.locator('#vaultContinue').isEnabled(), false);
    await page.locator('#vaultRecoverySaved').check(); await page.locator('#vaultContinue').click();
    await page.waitForFunction(() => !document.querySelector('.vault-overlay') && document.getElementById('loginOverlay').style.display === 'none');
    await page.locator('#btnMenu').click(); await page.locator('[data-tab="movimentos"]').click();
    await page.getByRole('button', { name: 'Gastei', exact: true }).click();
    await page.locator('#movDesc').fill('Gasto confidencial de teste'); await page.locator('#movValor').fill('23,45');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.waitForFunction(() => !WalletStorage.hasPending());
    assert(await page.getByText('Gasto confidencial de teste', { exact: true }).isVisible());
    const disk = await page.evaluate(() => Object.values(localStorage).join(''));
    assert(!disk.includes('Gasto confidencial de teste')); assert(!disk.includes('senha ficticia longa do teste'));
    assert.deepEqual(await page.evaluate(() => window.policyViolations), []);
    await context.setOffline(true); await page.reload();
    await page.locator('#btnContinuarLocal').click(); await page.locator('#vaultPassword').fill('senha ficticia longa do teste');
    await page.getByRole('button', { name: 'Desbloquear', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.vault-overlay') && document.getElementById('loginOverlay').style.display === 'none');
    await page.locator('#btnMenu').click(); await page.locator('[data-tab="movimentos"]').click();
    assert(await page.getByText('Gasto confidencial de teste', { exact: true }).isVisible());
    assert.deepEqual(await page.evaluate(() => window.policyViolations), []); assert.deepEqual(errors, []);
    fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.artifacts', 'offline-criptografado.png'), fullPage: true, animations: 'disabled' });
    console.log('OK: Chrome mobile 390px, Web Crypto nativa, CSP sem violações, cache completo e reabertura/desbloqueio sem internet.');
    await context.close();
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
