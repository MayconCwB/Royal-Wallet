/* Reinicia o navegador com perfil temporário; usa apenas carteira fictícia. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),allowed=new Set(['app-assets.json',...JSON.parse(fs.readFileSync(path.join(root,'app-assets.json'),'utf8'))]);
const profile=fs.mkdtempSync(path.join(root,'.artifacts/device-session-test-'));
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),file=url.pathname.startsWith('/Royal-Wallet/')?url.pathname.slice(14)||'index.html':'';if(!allowed.has(file)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':({'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png'})[path.extname(file)],'Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(root,'public',file)));});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let context;
 const errors=[],url=`http://localhost:${server.address().port}/Royal-Wallet/`,password='senha ficticia da sessao persistente';
 async function open(){context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,chromiumSandbox:true,viewport:{width:390,height:844}});await context.route('https://**',r=>r.abort());const page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-10-28T12:00:00Z'));return page;}
 const entered=page=>page.waitForFunction(()=>document.getElementById('loginOverlay').style.display==='none'&&!document.querySelector('.vault-overlay'));
 try{
  let page=await open();await page.goto(url);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.locator('#btnContinuarLocal').click();await page.locator('#vaultPassword').fill(password);await page.locator('#vaultConfirm').fill(password);await page.getByRole('button',{name:'Criar proteção',exact:true}).click();await page.waitForFunction(()=>document.getElementById('vaultRecoveryOutput')?.value.startsWith('RW1-'));await page.locator('#vaultRecoverySaved').check();await page.locator('#vaultContinue').click();await entered(page);
  await page.evaluate(()=>switchTab('movimentos'));
  async function future(desc,value,date){await page.getByRole('button',{name:'A receber',exact:true}).click();await page.locator('#movDesc').fill(desc);await page.locator('#movValor').fill(String(value));await page.locator('#movData').fill(date);await page.getByRole('button',{name:'Salvar',exact:true}).click();await page.waitForFunction(()=>!WalletStorage.hasPending());}
  await future('Receber do João',100,'2026-10-29');assert.equal(await page.evaluate(()=>calcMonthlyFinancials().saldoReal),0);
  assert((await page.locator('#walletMovementList').innerText()).includes('A receber (agendado)'));
  await future('Receber da Ana',250,'2026-11-03');assert.equal(await page.evaluate(()=>calcMonthlyFinancials().saldoReal),0);
  assert.equal(await page.locator('#tab-resumo #kpiEntradas').count(),0);assert.equal(await page.locator('#tab-movimentos #kpiEntradas').count(),1);
  await page.clock.setFixedTime(new Date('2026-10-29T12:00:00Z'));await page.evaluate(()=>renderAll());assert.equal(await page.evaluate(()=>calcMonthlyFinancials().saldoReal),100);
  await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));await page.evaluate(()=>renderAll());assert.equal(await page.evaluate(()=>calcMonthlyFinancials().saldoReal),350);
  await page.evaluate(()=>renderAll());assert.equal(await page.evaluate(()=>AppState.data.movimentos.length),2);
  console.log('OK: entradas futuras só afetam o saldo no dia escolhido, inclusive virada do mês; gráfico está na aba de lançamentos.');
  assert.equal(await page.evaluate(async()=>{const key=await WalletStorage.current('device').deviceKey();try{await crypto.subtle.exportKey('raw',key);return false;}catch{return key.extractable===false;}}),true);
  const disk=await page.evaluate(()=>Object.values(localStorage).join(''));assert(!disk.includes(password));assert(!disk.includes('Receber do João'));
  await page.screenshot({path:path.join(root,'.artifacts/entradas-futuras-publicacao.png'),fullPage:true});
  await context.close();context=null;
  page=await open();await context.setOffline(true);await page.goto(url);await entered(page);
  assert.equal(await page.locator('#vaultPassword').count(),0);assert.equal(await page.evaluate(()=>AppState.data.movimentos.length),2);
  console.log('OK: navegador encerrado e reaberto mantém acesso offline, sem senha, com chave não extraível e dados cifrados.');
  assert.equal(await page.evaluate(async()=>await WalletDeviceSession.restore('outro-usuario',WalletStorage.metadata('device'))),null);
  await page.evaluate(async()=>{logout();await WalletDeviceSession.restore('device',WalletStorage.metadata('device'));});
  await page.reload();assert.notEqual(await page.locator('#loginOverlay').evaluate(e=>e.style.display),'none');await page.locator('#btnContinuarLocal').click();await page.locator('#vaultPassword').waitFor();
  await page.locator('#vaultPassword').fill(password);await page.getByRole('button',{name:'Desbloquear',exact:true}).click();await entered(page);assert.equal(await page.evaluate(()=>AppState.data.movimentos.length),2);
  assert.deepEqual(errors,[]);console.log('OK: usuário diferente não herda acesso; Sair remove o acesso automático e preserva a carteira.');
  // Conta conectada: API Firebase inteiramente simulada, no mesmo navegador.
  let cloud=null,revision=0;
  async function fakeFirebase(){
    await context.route('https://identitytoolkit.googleapis.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(route.request().url().includes('accounts:lookup')?{users:[{localId:'cloud-session-test',email:'synthetic@example.invalid',displayName:'Sintético'}]}:{localId:'cloud-session-test',email:'synthetic@example.invalid',idToken:'test-token',refreshToken:'test-refresh',expiresIn:'3600'})}));
    await context.route('https://securetoken.googleapis.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user_id:'cloud-session-test',id_token:'test-token',refresh_token:'test-refresh',expires_in:'3600'})}));
    await context.route('https://firestore.googleapis.com/**',route=>{const request=route.request();if(request.method()==='PATCH')cloud={...request.postDataJSON(),updateTime:'revision-'+(++revision)};return route.fulfill({status:cloud?200:404,contentType:'application/json',body:JSON.stringify(cloud||{})});});
  }
  await page.evaluate(async()=>{logout();await WalletDeviceSession.restore('device',WalletStorage.metadata('device'));});await context.setOffline(false);await fakeFirebase();
  await page.locator('#authEmail').fill('synthetic@example.invalid');await page.locator('#authPassword').fill(password);await page.locator('#btnAuthSubmit').click();
  await page.waitForFunction(()=>document.getElementById('vaultRecoveryOutput')?.value.startsWith('RW1-'));
  assert.equal(await page.locator('#vaultForm').isVisible(),false);await page.locator('#vaultRecoverySaved').check();await page.locator('#vaultContinue').click();await entered(page);
  assert.equal(await page.evaluate(()=>AppState.user.uid),'cloud-session-test');assert.equal(await page.evaluate(()=>AppState.data.movimentos.length),0);
  await page.evaluate(()=>switchTab('movimentos'));await page.getByRole('button',{name:'Recebi',exact:true}).click();await page.locator('#movDesc').fill('Entrada da conta conectada');await page.locator('#movValor').fill('77');await page.getByRole('button',{name:'Salvar',exact:true}).click();
  await page.waitForFunction(()=>!WalletStorage.hasPending());await page.evaluate(async()=>{await syncPendingCloud();await WalletStorage.flush();});
  await context.close();context=null;page=await open();await fakeFirebase();await page.goto(url);await entered(page);
  assert.equal(await page.locator('#vaultPassword').count(),0);assert.equal(await page.evaluate(()=>AppState.user.uid),'cloud-session-test');assert.equal(await page.evaluate(()=>AppState.data.movimentos[0].valor),77);
  assert.deepEqual(errors,[]);console.log('OK: conta conectada usa uma única senha, mantém login após reiniciar e não herda registros locais de outro usuário.');
 }finally{if(context)await context.close();await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(profile),prefix=path.join(root,'.artifacts','device-session-test-');if(!resolved.startsWith(prefix))throw Error('Perfil fora da pasta de teste.');fs.rmSync(resolved,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
