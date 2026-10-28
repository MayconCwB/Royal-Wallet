/* Reproduz a migração de um cliente com crypto antigo no cache v10. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),files=new Set(['app-assets.json',...JSON.parse(fs.readFileSync(path.join(root,'app-assets.json'),'utf8'))]);
let stage='old';
const server=http.createServer((req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname,name=route.startsWith('/Royal-Wallet/')?route.slice(14)||'index.html':'';
  if(!files.has(name)){res.writeHead(404);res.end();return;}
  let data=fs.readFileSync(path.join(root,'public',name));
  if(stage==='old'&&name==='sw.js')data=fs.readFileSync(path.join(__dirname,'fixtures/sw-v10.js'));
  if(stage==='old'&&name==='js/security/crypto.js')data=Buffer.from(data.toString().replace(', wrapQuickUnlock, unlockQuick',''));
  const types={'.js':'application/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png'};
  res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':name==='sw.js'?'no-store':'public, max-age=86400'});res.end(data);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  const executable=process.env.ROYAL_TEST_BROWSER||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  browser=await chromium.launch({executablePath:executable,headless:true,chromiumSandbox:true});
  const context=await browser.newContext(),page=await context.newPage(),errors=[];await context.route('https://**',r=>r.abort());page.on('pageerror',e=>errors.push(e.message));
  const url=`http://localhost:${server.address().port}/Royal-Wallet/`;await page.goto(url);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  assert.equal(await page.evaluate(()=>typeof WalletCrypto.wrapQuickUnlock),'undefined');
  await page.locator('#btnContinuarLocal').click();const password='senha ficticia migracao cache';
  await page.locator('#vaultPassword').fill(password);await page.locator('#vaultConfirm').fill(password);await page.getByRole('button',{name:'Criar proteção',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('vaultRecoveryOutput')?.value.startsWith('RW1-'));await page.locator('#vaultRecoverySaved').check();await page.locator('#vaultContinue').click();
  await page.waitForFunction(()=>document.getElementById('loginOverlay').style.display==='none');
  await page.evaluate(()=>{AppState.data.movimentos.push({id:'migration-test',tipo:'despesa',desc:'Registro privado antes da atualização',valor:12.34,data:'2026-10-27',cat:'Outros'});triggerAutoSave();renderAll();});await page.waitForFunction(()=>!WalletStorage.hasPending());
  const protectedBefore=await page.evaluate(()=>localStorage.getItem('royalVaultData_device'));assert(protectedBefore&&!protectedBefore.includes('Registro privado'));
  stage='new';
  await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.getRegistration();
    const changed=new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    await registration.update();await changed;
  });
  assert.equal(await page.evaluate(()=>typeof WalletCrypto.wrapQuickUnlock),'undefined','Não recarrega nem interrompe a página com dados abertos.');
  assert.equal(await page.evaluate(()=>localStorage.getItem('royalVaultData_device')),protectedBefore);
  await page.reload();assert.equal(await page.evaluate(()=>typeof WalletCrypto.wrapQuickUnlock),'function');
  await page.locator('#btnContinuarLocal').click();await page.locator('#vaultPassword').fill(password);await page.getByRole('button',{name:'Desbloquear',exact:true}).click();await page.waitForFunction(()=>document.getElementById('loginOverlay').style.display==='none'&&!document.querySelector('.vault-overlay'));
  assert.equal(await page.evaluate(()=>AppState.data.movimentos[0].desc),'Registro privado antes da atualização');
  const installed=await page.evaluate(async()=>{const cache=await caches.open('royal-wallet-shell-v11');return(await cache.match('./js/security/crypto.js')).text();});
  assert(installed.includes('wrapQuickUnlock, unlockQuick'));
  await context.setOffline(true);await page.reload();assert.equal(await page.evaluate(()=>typeof WalletCrypto.wrapQuickUnlock),'function');
  assert.deepEqual(errors,[]);await context.close();
  console.log('OK: cache v10/HTTP antigo migra para v11 coerente; mantém dados cifrados, senha e acesso offline, sem recarregar a carteira aberta.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
