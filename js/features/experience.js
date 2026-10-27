/* Experiência financeira: leitura e gravação usam a sessão criptográfica da carteira. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id), esc=escapeHtml;
  let now=new Date(), year=now.getFullYear(), month=now.getMonth(), mes=`${year}-${String(month+1).padStart(2,'0')}`;
  function refreshPeriod(){const old=mes;now=new Date();year=now.getFullYear();month=now.getMonth();mes=`${year}-${String(month+1).padStart(2,'0')}`;if(old!==mes&&$('walletMovementMonth')?.value===old)$('walletMovementMonth').value=mes;}
  const iso=(day,m=month,y=year)=>`${y}-${String(m+1).padStart(2,'0')}-${String(Math.min(day,new Date(y,m+1,0).getDate())).padStart(2,'0')}`;
  const incomes=()=>AppState.data.rendasPrevistas || [];
  const expenses = data => data.movimentos.filter(m=>m.tipo==='despesa'&&m.classe!=='pagamento_fatura');
  const received=item=>AppState.data.movimentos.some(m=>m.origem===`renda:${item.id}:${mes}`);
  const pending=()=>incomes().filter(item=>item.valor>0&&!received(item)).reduce((sum,item)=>sum+item.valor,0);
  const baseCalculate=calcMonthlyFinancials;
  const limits=()=> (AppState.data.orcamentos || []).filter(item=>item.mes===mes);
  function update(){triggerAutoSave();renderAll();renderIncome();}
  function button(label,action,primary=false){const b=document.createElement('button');b.className=primary?'btn btn-primary':'btn btn-outline';b.textContent=label;b.onclick=action;return b;}
  function input(id,label,value='',type='text'){return `<div class="form-group"><label for="${id}">${esc(label)}</label><input id="${id}" class="input-field" type="${type}" value="${esc(String(value))}"></div>`;}
  function error(msg){$('walletError').textContent=msg;}
  function modal(title,html,save,label='Salvar'){
    const formOwner=localDataKey();
    if(!WalletPrivacy.ready())return;
    openModal(title,html+'<p id="walletError" role="alert"></p>',[{label:'Voltar',onClick:closeModal},{label,primary:true,onClick:()=>{try{if(!WalletPrivacy.ready()||localDataKey()!==formOwner)throw Error('A sessão mudou. Desbloqueie a carteira e abra o formulário novamente.');if(save()!==false)closeModal();}catch(e){error(e.message);}}}]);
  }
  const num=id=>parseNumericInput($(id).value);
  const requireAmount=value=>{const cents=Math.round(value*100);if(!Number.isFinite(value)||!Number.isSafeInteger(cents)||cents<=0)throw Error('Informe um valor maior que zero, dentro do tamanho numérico suportado.');return cents/100;};
  calcMonthlyFinancials=()=>{refreshPeriod();const result=baseCalculate();return {...result,precisoTer:Math.max(0,result.compromissosMes-result.saldoReal-pending()),saldoPrevisto:result.saldoReal+pending()-result.compromissosMes};};
  function confirmIncome(item){
    if(received(item))return;
    const existing=AppState.data.movimentos.filter(x=>x.tipo==='receita'&&x.data?.startsWith(mes)&&!String(x.origem||'').startsWith('renda:'));
    const match=existing.length?`<label for="incomeExisting">Já registrou essa entrada?</label><select id="incomeExisting" class="input-field"><option value="">Escolha para evitar duplicação</option><option value="new">Ainda não, criar entrada</option>${existing.map(x=>`<option value="${esc(x.id)}">${esc(x.desc||x.descricao||'Entrada')} — ${fmtBRL(x.valor)}</option>`).join('')}</select>`:'';
    modal(`Recebi meu ${item.nome.toLowerCase()}`,match+input('incomeValue','Quanto entrou?',item.valor,'number')+input('incomeDate','Data do recebimento',iso(now.getDate()),'date'),()=>{
      if(existing.length){const selected=$('incomeExisting').value;if(!selected)throw Error('Escolha se esta entrada já existe ou se deve criar uma nova.');if(selected!=='new'){const linked=AppState.data.movimentos.find(x=>x.id===selected&&x.tipo==='receita'&&x.data?.startsWith(mes));if(!linked)throw Error('O registro mudou. Abra o recebimento novamente.');if(!received(item))linked.origem=`renda:${item.id}:${mes}`;update();return;}}
      const valor=requireAmount(num('incomeValue')),data=parseCsvDate($('incomeDate').value);if(!data||data.slice(0,7)!==mes)throw Error('Escolha uma data do mês do recebimento previsto.');
      if(!received(item))AppState.data.movimentos.push({id:uidGen(),tipo:'receita',desc:item.nome,cat:'Salário',valor,data,origem:`renda:${item.id}:${mes}`});update();
    },'Confirmar entrada');
  }
  function choosePendingIncome(){
    const items=incomes().filter(item=>item.valor>0&&!received(item));if(!items.length)return;if(items.length===1)return confirmIncome(items[0]);
    openModal('Qual recebimento entrou?', '<p>Escolha apenas o valor que já recebeu. Os outros continuam previstos.</p>',[{label:'Voltar',onClick:closeModal},...items.map(item=>({label:`${item.nome} · ${fmtBRL(item.valor)}`,primary:true,onClick:()=>confirmIncome(item)}))]);
  }
  function renderIncome(){
    if(!$('walletIncome'))return;
    $('walletIncomeRows').replaceChildren();
    for(const item of incomes()){const row=document.createElement('div');row.className='wallet-income-row';const label=document.createElement('div');label.innerHTML=`<strong>${esc(item.nome)} · ${fmtBRL(item.valor)}</strong><small>Todo mês, dia ${item.dia}</small>`;row.append(label);$('walletIncomeRows').append(row);}
    if(!incomes().length)$('walletIncomeRows').textContent='Nenhum recebimento previsto cadastrado. Você pode configurar salário, vale ou ambos.';
    const awaiting=incomes().filter(item=>item.valor>0&&!received(item));
    $('walletPendingIncome').hidden=awaiting.length===0;
    $('walletIncomeTotal').textContent=awaiting.length?`A receber neste mês: ${fmtBRL(pending())} — ${awaiting.map(item=>`${item.nome}, dia ${item.dia}`).join(' · ')}`:'';
    const legacy=$('walletLegacyAccounts');if(legacy)legacy.hidden=!(AppState.data.contas?.length||AppState.data.cartoes?.length);
    const gap=$('kpiPrecisoTer')?.closest('.kpi-card')?.querySelector('.kpi-title');if(gap)gap.childNodes[0].textContent=calcMonthlyFinancials().compromissosMes?'Falta para os compromissos ':'Déficit dos registros ';
  }
  function quick(desc='',cat='Outros',tipo='despesa'){
    openMovimentoForm();$('movTipo').value=tipo;$('movDesc').value=desc;$('movCategoria').value=cat;
    for(const id of ['movOrigem','movFatura'])if($(id))$(id).closest('.form-group').hidden=true;
    const help=$('genericModalBody').querySelector('p.wallet-muted');if(help)help.textContent='Entradas aumentam o saldo. Gastos registram dinheiro que já saiu. Os valores são registrados por você.';
    if(tipo==='despesa'){
      const favorites=document.createElement('div');favorites.className='wallet-favorites';
      const label=document.createElement('span');label.textContent='Usar favorito:';favorites.append(label);
      for(const [name,category] of [['Mercado','Alimentação'],['Transporte','Transporte']])favorites.append(button(name,()=>{$('movDesc').value=name;$('movCategoria').value=category;$('movValor').focus();}));
      $('genericModalBody').prepend(favorites);
    }
  }
  function payment(id,value,desc,cat,source){AppState.data.movimentos.push({id,tipo:'despesa',desc,descricao:desc,cat,valor:value,data:iso(now.getDate()),origem:source});}
  window.handleToggleRecorrentePago=id=>{if(!WalletPrivacy.ready())return;refreshPeriod();const item=AppState.data.recorrentes.find(x=>x.id===id);if(!item)return;const source=`fixa:${id}:${mes}`;const paid=item.ultimoMesPago?item.ultimoMesPago>=mes:item.pagoNesteMes;if(paid){if(!confirm('Desfazer este pagamento e o gasto gerado automaticamente?'))return;item.ultimoMesPago='';item.pagoNesteMes=false;AppState.data.movimentos=AppState.data.movimentos.filter(x=>x.origem!==source);}else{item.ultimoMesPago=mes;item.pagoNesteMes=true;if(!AppState.data.movimentos.some(x=>x.origem===source))payment(uidGen(),item.valor,'Pagamento — '+item.desc,item.cat||'Contas',source);}update();};
  const baseAdjust=window.handleAdjustParcelasPagas;
  window.handleAdjustParcelasPagas=(id,delta)=>{if(!WalletPrivacy.ready()||![1,-1].includes(delta))return;refreshPeriod();const item=AppState.data.parcelas.find(x=>x.id===id);if(!item)return;const before=item.pagas||0,desc=item.desc,valor=item.valor;baseAdjust(id,delta);const next=Math.max(0,Math.min(item.total,before+delta));if(next===before)return;const source=`parcela:${id}:${delta>0?next:before}`;if(delta>0&&!AppState.data.movimentos.some(x=>x.origem===source))payment(uidGen(),valor,`Parcela ${next} — ${desc}`,'Parcelas',source);if(delta<0)AppState.data.movimentos=AppState.data.movimentos.filter(x=>x.origem!==source);update();};
  function debtPayment(id,full=false){if(!WalletPrivacy.ready())return;refreshPeriod();const item=AppState.data.dividas.find(x=>x.id===id);if(!item)return;const rest=item.total-item.pago;modal(full?'Quitar dívida':'Registrar pagamento da dívida',`<p>${esc(item.desc)} · Faltam ${fmtBRL(rest)}</p>`+input('debtPaymentAmount','Quanto você pagou?',full?rest:'','number'),()=>{if(!AppState.data.dividas.includes(item))throw Error('A dívida mudou. Abra novamente.');const value=requireAmount(num('debtPaymentAmount'));if(value>item.total-item.pago)throw Error('O pagamento não pode ultrapassar o valor pendente.');item.pago=Math.round((item.pago+value)*100)/100;item.valorPago=item.pago;payment(uidGen(),value,'Pagamento — '+item.desc,'Dívidas','divida:'+id);if(item.pago===item.total){AppState.data.historico.push({id:item.id,tipo:'Dívida',nome:item.desc,desc:item.desc,valorTotal:item.total,concluidoEm:Date.now(),original:{...item}});AppState.data.dividas=AppState.data.dividas.filter(x=>x.id!==id);}update();},'Confirmar pagamento');}
  window.handleAmortizarDivida=id=>debtPayment(id);window.handleQuitarDivida=id=>debtPayment(id,true);
  function simulate(){
    openModal('Antes de comprar', '<p>Veja quanto uma nova compra comprometeria o mês, sem alterar seus registros.</p><div class="wallet-form-grid">'+input('simTotal','Valor total da compra',1200,'number')+input('simCount','Em quantas parcelas?',6,'number')+'</div><div id="simResult" class="wallet-result" aria-live="polite"></div>',[{label:'Fechar simulação',onClick:closeModal}]);
    const draw=()=>{const total=num('simTotal'),count=Number($('simCount').value);if(!Number.isFinite(total)||total<=0||!Number.isSafeInteger(count)||count<1){$('simResult').textContent='Informe um valor e uma quantidade válida.';return;}const installment=Math.ceil(total*100/count)/100,fin=calcMonthlyFinancials(),after=fin.saldoPrevisto-installment;$('simResult').innerHTML=`<strong>${count} parcelas de aproximadamente ${fmtBRL(installment)}</strong><p>Se a primeira parcela entrar neste mês, sua projeção passa de ${fmtBRL(fin.saldoPrevisto)} para ${fmtBRL(after)}.</p><p class="wallet-muted">Sem juros informados. A última parcela pode ajustar centavos. A projeção usa os dados e recebimentos previstos desta carteira; não é garantia de saldo nem orientação de crédito.</p><p>${after<0?'A compra faria o planejamento deste mês ficar negativo.':'A projeção deste mês continuaria positiva.'}</p>`;};
    $('simTotal').oninput=draw;$('simCount').oninput=draw;draw();
  }
  function nextIncome(){refreshPeriod();
    const candidates=incomes().filter(x=>x.valor>0&&!received(x)).map(item=>({...item,date:new Date(year,month,Math.min(item.dia,new Date(year,month+1,0).getDate()))})).sort((a,b)=>a.date-b.date);
    const next=candidates[0];if(!next){openModal('Até o próximo recebimento','<p>Todos os recebimentos previstos deste mês já foram confirmados. </p>',[{label:'Entendi',onClick:closeModal}]);return;}
    const today=now.getDate(),cutoff=Math.max(today,next.date.getDate());
    const fixed=AppState.data.recorrentes.filter(x=>x.tipo!=='receita'&&!(x.ultimoMesPago?x.ultimoMesPago>=mes:x.pagoNesteMes)&&Math.min(x.dia,new Date(year,month+1,0).getDate())<=cutoff).reduce((s,x)=>s+x.valor,0);
    const debts=AppState.data.dividas.filter(x=>x.venc&&x.venc<=iso(cutoff)).reduce((s,x)=>s+Math.max(0,x.total-x.pago),0);
    const installments=AppState.data.parcelas.filter(x=>{const d=getNextParcelaDate(x.data1,x.pagas);return x.pagas<x.total&&d&&d.iso<=iso(cutoff);}).reduce((s,x)=>s+x.valor,0);
    const cards=WalletFeatures.invoices().filter(x=>x.vencimento<=iso(cutoff)).reduce((s,x)=>s+x.restante,0);
    const commitment=fixed+debts+installments+cards,available=calcMonthlyFinancials().saldoReal;
    openModal('Até o próximo recebimento',`<h3>${esc(next.nome)} previsto para dia ${next.dia}</h3><p>Valor previsto: <strong>${fmtBRL(next.valor)}</strong>${next.date.getDate()<today?' · Ainda não confirmado; a data prevista já passou.':''}</p><div class="wallet-result"><p>Saldo calculado agora: <strong>${fmtBRL(available)}</strong></p><p>Compromissos pendentes até ${iso(cutoff).split('-').reverse().join('/')} (inclui vencidos): <strong>${fmtBRL(commitment)}</strong></p><p>${available>=commitment?'Depois desses compromissos, restariam '+fmtBRL(available-commitment)+'.':'Faltariam '+fmtBRL(commitment-available)+' para cobrir esses compromissos.'}</p></div><p class="wallet-muted">Inclui vencimentos no mesmo dia do recebimento, por cautela. O aplicativo não conhece o horário de depósito nem despesas futuras não cadastradas.</p>`,[{label:'Fechar',onClick:closeModal}]);
  }
  function subscriptions(){const items=AppState.data.recorrentes.filter(x=>x.assinatura),sum=items.reduce((s,x)=>s+x.valor,0);openModal('Minhas assinaturas',`<p>Serviços que você identifica como assinatura, reunidos a partir das suas contas fixas.</p><div class="wallet-result"><strong>${fmtBRL(sum)} por mês · ${fmtBRL(sum*12)} por ano</strong></div><ul>${items.map(x=>`<li>${esc(x.desc)} — ${fmtBRL(x.valor)}/mês</li>`).join('')}</ul><p class="wallet-muted">O total anual pressupõe 12 mensalidades iguais. Não detectamos nem cancelamos contratos automaticamente.</p>`,[{label:'Fechar',onClick:closeModal}]);}
  function report(){refreshPeriod();
    const all=expenses(AppState.data),current=all.filter(x=>x.data.startsWith(mes)),previousKey=iso(1,month===0?11:month-1,month===0?year-1:year).slice(0,7),previous=all.filter(x=>x.data.startsWith(previousKey)).reduce((s,x)=>s+x.valor,0),sum=current.reduce((s,x)=>s+x.valor,0);
    const categories=new Map();current.forEach(x=>categories.set(x.cat,(categories.get(x.cat)||0)+x.valor));
    openModal('Seu relatório do mês',`<div class="wallet-report"><h2>Royal Wallet · ${new Date(year,month,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</h2><p>Relatório financeiro pessoal</p><p>Gastos registrados: <strong>${fmtBRL(sum)}</strong><br>Mês anterior: ${fmtBRL(previous)}<br>Diferença: ${fmtBRL(sum-previous)}</p><table><thead><tr><th>Categoria</th><th>Gasto</th></tr></thead><tbody>${[...categories].map(([cat,value])=>`<tr><td>${esc(cat)}</td><td>${fmtBRL(value)}</td></tr>`).join('')}</tbody></table><p>Recebimentos ainda previstos: ${fmtBRL(pending())}. Projeção após os compromissos: ${fmtBRL(calcMonthlyFinancials().saldoPrevisto)}.</p></div>`,[{label:'Fechar',onClick:closeModal},{label:'Imprimir / salvar como PDF',primary:true,onClick:()=>window.print()}]);
  }
  function parseOfx(text){
    const tag=(source,name)=>(source.match(new RegExp('<'+name+'>\\s*([^<\\r\\n]+)','i'))?.[1]||'').trim();
    const account=[tag(text,'BANKID'),tag(text,'BRANCHID'),tag(text,'ACCTID')||tag(text,'CCACCTFROM')].join(':');
    return [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].flatMap(([,block])=>{
      const raw=tag(block,'DTPOSTED'),data=`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`,valor=Number(tag(block,'TRNAMT'));
      if(!parseCsvDate(data)||!Number.isSafeInteger(Math.round(valor*100))||valor===0)return[];
      const desc=tag(block,'MEMO')||tag(block,'NAME')||'Registro do extrato';
      return[{id:'ofx:'+account+':'+(tag(block,'FITID')||[data,valor,desc].join(':')),data,desc,descricao:desc,valor:Math.abs(Math.round(valor*100))/100,tipo:valor>0?'receita':'despesa',cat:'Outros'}];
    });
  }
  function importOfx(text){
    if(!WalletPrivacy.ready())return;const owner=localDataKey(),items=parseOfx(text);
    if(!items.length)return alert('O arquivo não contém transações OFX reconhecidas nesta carteira.');
    const same=(a,b)=>a.tipo===b.tipo&&a.data===b.data&&Math.round(a.valor*100)===Math.round(b.valor*100)&&String(a.desc||a.descricao).trim().toLocaleLowerCase('pt-BR')===String(b.desc||b.descricao).trim().toLocaleLowerCase('pt-BR');
    const seen=new Set(AppState.data.movimentos.map(x=>x.id)),duplicate=x=>AppState.data.movimentos.some(m=>same(m,x));
    openModal('Conferir extrato OFX',`<p>Confira os itens. Duplicatas já importadas são bloqueadas; registros semelhantes ficam desmarcados para você conferir.</p><div class="wallet-review">${items.map((x,i)=>`<label class="wallet-check"><input type="checkbox" id="ofxPick${i}" ${seen.has(x.id)?'disabled':duplicate(x)?'':'checked'}><span>${esc(x.desc)} · ${esc(x.data)} · ${x.tipo==='receita'?'+':'−'} ${fmtBRL(x.valor)}${seen.has(x.id)?' · Já importado':duplicate(x)?' · Possível duplicata':''}</span></label>`).join('')}</div>`,[{label:'Cancelar',onClick:closeModal},{label:'Importar selecionados',primary:true,onClick:()=>{
      if(!WalletPrivacy.ready()||localDataKey()!==owner)return alert('A sessão mudou. Abra o arquivo novamente.');
      const current=new Set(AppState.data.movimentos.map(x=>x.id)),selected=items.filter((x,i)=>$('ofxPick'+i).checked&&!current.has(x.id)),unique=new Map(selected.map(x=>[x.id,x]));
      AppState.data.movimentos.push(...unique.values());update();closeModal();showToast(unique.size+' registro(s) importado(s) na carteira.');
    }}]);
  }
  function simplifyMovements(importButton){
    const section=$('tab-movimentos'),filterPanel=$('buscaMovimento').closest('.panel'),oldTable=$('tabelaMovimentos').closest('.table-container');
    const actions=section.querySelector('.wallet-actions');actions.replaceChildren(button('Recebi',()=>quick('','Salário','receita'),true),button('Gastei',()=>quick(),true));actions.classList.add('wallet-primary-actions');
    section.querySelector('p.wallet-muted')?.remove();
    oldTable.hidden=true;
    const context=document.createElement('div');context.className='wallet-ledger-context';
    const period=document.createElement('p');period.id='walletLedgerPeriod';period.className='wallet-muted';
    const more=button('Mais opções',()=>{const open=$('walletMovementOptions').hidden; $('walletMovementOptions').hidden=!open;more.setAttribute('aria-expanded',String(open));});
    more.id='walletMovementMore';more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls','walletMovementOptions');context.append(period,more);actions.after(context);
    const options=document.createElement('div');options.id='walletMovementOptions';options.className='wallet-movement-options';options.hidden=true;
    options.innerHTML=`<div class="wallet-form-grid"><label>Mês <input type="month" id="walletMovementMonth" class="input-field" value="${mes}"></label><label class="wallet-check"><input type="checkbox" id="walletMovementAll"> Todo o período</label></div>`;
    options.append(filterPanel,importButton);context.after(options);
    $('btnNovoMovimento').parentElement.hidden=true;
    const list=document.createElement('ul');list.id='walletMovementList';list.className='wallet-ledger';list.setAttribute('aria-label','Registros de entradas e gastos');options.after(list);
    function details(id){
      const item=AppState.data.movimentos.find(x=>x.id===id);if(!item)return;
      if (/^(fixa|parcela|divida):/.test(item.origem||'')) {openModal('Pagamento vinculado', '<p>Este gasto foi criado ao pagar um compromisso. Corrija o pagamento na área de origem para manter o saldo e a pendência consistentes.</p>', [{label:'Fechar',onClick:closeModal},{label:'Ver compromisso',primary:true,onClick:()=>{closeModal();switchTab(item.origem.startsWith('fixa:')?'recorrentes':item.origem.startsWith('parcela:')?'parcelas':'dividas');}}]);return;}
      openModal(item.tipo==='receita'?'Detalhes da entrada':'Detalhes do gasto',`<div class="wallet-record-detail"><h3>${esc(item.desc||item.descricao||'Sem descrição')}</h3><p class="${item.tipo==='receita'?'wallet-value-in':'wallet-value-out'}">${item.tipo==='receita'?'+':'−'} ${fmtBRL(item.valor)}</p><p>Data: ${esc(item.data?item.data.split('-').reverse().join('/'):'Sem data')}<br>Categoria: ${esc(item.cat||item.categoria||'Outros')}</p></div>`,[
        {label:'Fechar',onClick:closeModal},
        {label:'Mover para lixeira',onClick:()=>{window.handleDeleteMovimento(id);closeModal();}},
        {label:'Editar',primary:true,onClick:()=>{if(String(item.origem||'').startsWith('renda:'))return alert('Para corrigir o recebimento, mova esta entrada para a lixeira e confirme novamente pelo Resumo.');window.handleEditMovimento(id);}}
      ]);
    }
    function renderList(){
      const all=$('walletMovementAll').checked,selected=$('walletMovementMonth').value||mes,term=$('buscaMovimento').value.trim().toLocaleLowerCase('pt-BR'),type=$('filtroTipoMovimento').value;
      $('walletMovementMonth').disabled=all;
      const items=AppState.data.movimentos.filter(x=>(all||x.data?.slice(0,7)===selected)&&(type==='todos'||x.tipo===type)&&`${x.desc||x.descricao||''} ${x.cat||x.categoria||''}`.toLocaleLowerCase('pt-BR').includes(term)).sort((a,b)=>String(b.data||'').localeCompare(String(a.data||'')));
      const [y,m]=selected.split('-').map(Number),monthLabel=new Date(y,m-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
      period.textContent=(all?'Todo o período':monthLabel.charAt(0).toUpperCase()+monthLabel.slice(1))+' · '+items.length+(items.length===1?' registro':' registros');
      list.replaceChildren();$('movimentosTbody').replaceChildren();
      if(!items.length){const empty=document.createElement('li');empty.className='wallet-ledger-empty';empty.textContent=all?'Nenhum registro encontrado.':'Nenhum registro encontrado neste mês.';list.append(empty);}
      for(const item of items){
        const li=document.createElement('li'),row=document.createElement('button');row.type='button';row.className='wallet-record';row.dataset.movementId=item.id;
        const text=document.createElement('span'),name=document.createElement('strong'),date=document.createElement('small'),value=document.createElement('span');
        name.textContent=item.desc||item.descricao||'Sem descrição';date.textContent=item.data?item.data.split('-').reverse().join('/'):'Sem data';text.append(name,date);
        value.textContent=(item.tipo==='receita'?'+ ':'− ')+fmtBRL(item.valor);value.className=item.tipo==='receita'?'wallet-value-in':'wallet-value-out';row.append(text,value);row.onclick=()=>details(item.id);li.append(row);list.append(li);
      }
    }
    renderMovimentos=renderList;
    for(const id of ['buscaMovimento','filtroTipoMovimento','walletMovementMonth','walletMovementAll'])$(id).addEventListener(id==='buscaMovimento'?'input':'change',renderList);
    renderList();
  }
  function normalizeIncome(raw){
    const ids=new Set();return (Array.isArray(raw)?raw:[]).flatMap((item,index)=>{
      if(!item||typeof item.nome!=='string')return[];const nome=item.nome.trim(),id=String(item.id||'renda-'+index),valor=Number(item.valor),dia=Number(item.dia),cents=Math.round(valor*100);
      if(!nome||nome.length>80||!id||id.length>100||ids.has(id)||!Number.isInteger(dia)||dia<1||dia>31||!Number.isSafeInteger(cents)||cents<0)return[];
      ids.add(id);return[{id,nome,valor:cents/100,dia}];
    });
  }
  const baseNormalizeData=normalizeDataStructure;
  normalizeDataStructure=(raw,source)=>{
    const result=baseNormalizeData(raw,source);result.rendasPrevistas=normalizeIncome(raw?.rendasPrevistas);result.avisosAtivos=raw?.avisosAtivos===true;
    const originals=new Map((Array.isArray(raw?.recorrentes)?raw.recorrentes:[]).filter(Boolean).map(x=>[String(x.id),x]));
    result.recorrentes.forEach(item=>{item.assinatura=originals.get(item.id)?.assinatura===true;});return result;
  };
  const baseEmptyData=emptyWallet;emptyWallet=()=>({...baseEmptyData(),rendasPrevistas:[],avisosAtivos:false});
  function configureIncome(){
    const entries=incomes().length?incomes():[{id:'salario',nome:'Salário',valor:0,dia:5},{id:'vale',nome:'Vale',valor:0,dia:20}];
    modal('Meus recebimentos do mês','<p class="wallet-muted">Configure o que espera receber. Use zero para desativar um recebimento. O saldo só muda após confirmar a entrada.</p><div class="wallet-form-grid">'+entries.map((item,i)=>input('incomeAmount'+i,'Valor do '+item.nome.toLowerCase(),item.valor,'number')+input('incomeDay'+i,'Dia do '+item.nome.toLowerCase(),item.dia,'number')).join('')+'</div>',()=>{
      const values=entries.map((item,i)=>({...item,valor:num('incomeAmount'+i),dia:Number($('incomeDay'+i).value)}));
      if(normalizeIncome(values).length!==entries.length)throw Error('Confira valores não negativos e dias de 1 a 31.');
      AppState.data.rendasPrevistas=normalizeIncome(values);update();
    });
  }
  function reminders(){
    const active=AppState.data.avisosAtivos===true,overdue=WalletFeatures.summaryInsights().overdue;
    openModal('Lembretes no aplicativo',`<p>${active?'Avisos de vencimento ativados.':'Avisos de vencimento desativados.'}</p><p>${overdue.length?`${overdue.length} compromisso(s) vencido(s) ainda pendente(s).`:'Nenhum vencimento pendente identificado.'}</p><p class="wallet-muted">Os avisos aparecem enquanto você usa o aplicativo. Não são enviadas notificações quando ele está fechado.</p>`,[{label:'Fechar',onClick:closeModal},{label:active?'Desativar avisos':'Ativar avisos',primary:true,onClick:()=>{if(!WalletPrivacy.ready())return;AppState.data.avisosAtivos=!active;update();closeModal();showToast('Preferência de avisos atualizada.');}}]);
  }
  function budgets(){
    const rows=WalletBudgets.summarize(AppState.data,mes).rows;
    openModal('Limites por categoria',`<p>Orçamento de ${new Date(year,month,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}. Compras no cartão entram pela data da compra; a fatura não é contada duas vezes.</p><div id="walletBudgetList"></div>`,[{label:'Fechar',onClick:closeModal},{label:'Definir limite',primary:true,onClick:()=>modal('Definir limite',input('newBudgetCat','Categoria','Alimentação')+input('newBudgetValue','Limite mensal',500,'number'),()=>{
      const categoria=$('newBudgetCat').value.trim(),limite=requireAmount(num('newBudgetValue'));
      const existing=limits().find(x=>x.categoria.trim().toLocaleLowerCase('pt-BR')===categoria.toLocaleLowerCase('pt-BR'));
      WalletBudgets.save({id:existing?.id,mes,categoria,limite});setTimeout(()=>{if(WalletPrivacy.ready())budgets();},0);
    })}]);
    if(!rows.length)$('walletBudgetList').textContent='Nenhum limite definido para este mês.';
    for(const item of rows){const article=document.createElement('article');article.innerHTML=`<strong>${esc(item.categoria)}</strong><p>${fmtBRL(item.gasto)} de ${fmtBRL(item.limite)}</p><progress value="${Math.min(item.gasto,item.limite)}" max="${item.limite}" aria-label="Gasto de ${esc(item.categoria)}"></progress><p>${item.restante<0?fmtBRL(-item.restante)+' acima do limite':fmtBRL(item.restante)+' disponíveis nesta categoria'}</p>`;article.append(button('Editar limite',()=>modal('Editar limite',input('editBudgetValue','Limite mensal',item.limite,'number'),()=>{WalletBudgets.save({...item,limite:requireAmount(num('editBudgetValue'))});setTimeout(()=>{if(WalletPrivacy.ready())budgets();},0);})),button('Remover limite',()=>{if(WalletPrivacy.ready()&&confirm('Remover o limite? Seus lançamentos serão mantidos.')){WalletBudgets.remove(item.id);budgets();}}));$('walletBudgetList').append(article);}
  }
  HELP_DICTIONARY['Saldo Real']='Saldo calculado pelos registros e saldos iniciais que você informou. O aplicativo não consulta o seu banco.';
  HELP_DICTIONARY['Quanto Preciso Ter']='Diferença calculada considerando saldo registrado, compromissos pendentes e recebimentos previstos. Um saldo negativo pode vir de gastos já registrados, mesmo sem contas pendentes.';
  HELP_DICTIONARY['Saldo Previsto Final']='Saldo calculado mais os recebimentos ainda previstos, menos os compromissos pendentes. Não é uma consulta ao banco nem garantia de saldo futuro.';
  globalThis.WalletExperience=Object.freeze({normalizeIncome,received,pending,refreshPeriod,configureIncome,report,simulate,parseOfx,importOfx});
  const baseRender=renderAll;renderAll=()=>{baseRender();renderIncome();};
  document.addEventListener('DOMContentLoaded',()=>{
      document.querySelector('[data-tab="contascartoes"]')?.remove();$('tab-contascartoes').hidden=true;
      const legacy=document.createElement('div');legacy.id='walletLegacyAccounts';legacy.className='panel wallet-card';legacy.hidden=true;legacy.innerHTML='<h3>Registros anteriores de contas e cartões</h3><p>Dados antigos foram preservados para não alterar seus saldos nem impedir a quitação de faturas já cadastradas.</p>';legacy.append(button('Consultar registros anteriores',()=>{$('tab-contascartoes').hidden=false;switchTab('contascartoes');}));$('tab-config').append(legacy);
      document.querySelector('[data-tab="movimentos"]').textContent='💵 Entradas e gastos';
      $('tab-movimentos').querySelector('h2').childNodes[0].textContent='💵 Entradas e gastos ';
      const note=document.createElement('p');note.className='wallet-muted';note.textContent='Entradas: dinheiro que você recebeu. Gastos: dinheiro que já saiu. Salário e vale previstos só entram no saldo após a confirmação.';$('tab-movimentos').insertBefore(note,$('tab-movimentos').children[1]);
      const quickBar=document.createElement('div');quickBar.className='wallet-actions';quickBar.append(button('＋ Recebi dinheiro',()=>quick('','Salário','receita'),true),button('− Registrei um gasto',()=>quick(),true),button('★ Mercado',()=>quick('Mercado','Alimentação')),button('★ Transporte',()=>quick('Transporte','Transporte')));$('tab-movimentos').insertBefore(quickBar,note.nextSibling);$('btnNovoMovimento').hidden=true;
      const importButton=$('btnImportarCsv').cloneNode(true);$('btnImportarCsv').replaceWith(importButton);importButton.textContent='Importar extrato CSV / OFX';
      const upload=document.createElement('input');upload.type='file';upload.accept='.ofx,.csv';upload.hidden=true;document.body.append(upload);importButton.onclick=()=>upload.click();upload.onchange=async()=>{const f=upload.files[0],owner=localDataKey();if(!f)return;try{if(!WalletPrivacy.ready()||f.size>5*1024*1024)throw Error('Desbloqueie a carteira e use um arquivo de até 5 MB.');if(f.name.toLowerCase().endsWith('.ofx')){const text=await f.text();if(WalletPrivacy.ready()&&owner===localDataKey())importOfx(text);}else importCsvFile(f);}catch(e){alert(e.message);}finally{upload.value='';}};
      simplifyMovements(importButton);
      const baseOpen=openMovimentoForm;openMovimentoForm=editing=>{baseOpen(editing);for(const id of ['movOrigem','movFatura'])if($(id))$(id).closest('.form-group').hidden=true;const p=$('genericModalBody').querySelector('p.wallet-muted');if(p)p.textContent='Registre valores que já entraram ou saíram. Para recebimentos previstos, use Salário e vale nas Configurações.';};
      const originalLabels=[['kpiSaldoReal','Saldo calculado'],['kpiEntradas','Recebido neste mês'],['kpiGastos','Gastos registrados'],['kpiCompromissos','Ainda falta pagar'],['kpiPrecisoTer','Falta para os compromissos'],['kpiSaldoPrevisto','Previsão depois de pagar tudo']];originalLabels.forEach(([id,label])=>{const title=$(id).closest('.kpi-card').querySelector('.kpi-title');title.childNodes[0].textContent=label+' ';});
      const section=document.createElement('div');section.id='walletIncome';section.className='panel wallet-income';section.innerHTML='<h3>Salário e vale</h3><p class="wallet-muted">Cadastre os valores e os dias que você espera receber. Confirme a entrada pelo aviso no Resumo quando o dinheiro chegar.</p><div id="walletIncomeRows"></div>';section.append(button('Ajustar valores e dias',configureIncome));$('tab-config').insertBefore(section,$('tab-config').children[1]);
      const pendingLine=document.createElement('div');pendingLine.id='walletPendingIncome';pendingLine.className='wallet-pending-income';pendingLine.setAttribute('aria-live','polite');pendingLine.innerHTML='<span id="walletIncomeTotal"></span>';pendingLine.append(button('Confirmar recebimento',choosePendingIncome));$('tab-resumo').insertBefore(pendingLine,$('walletInsights'));
      const actions=document.createElement('div');actions.className='wallet-actions';actions.append(button('Até o próximo recebimento',nextIncome),button('Relatório do mês',report),button('Lembretes',reminders));$('tab-resumo').insertBefore(actions,pendingLine.nextSibling);
      const planActions=document.createElement('div');planActions.className='wallet-actions';planActions.append(button('Simular uma compra',simulate,true),button('Limites por categoria',budgets));$('tab-planejamento').insertBefore(planActions,$('tab-planejamento').children[1]);
      const subscriptionAction=document.createElement('div');subscriptionAction.className='wallet-actions';subscriptionAction.append(button('Ver minhas assinaturas',subscriptions));$('tab-recorrentes').insertBefore(subscriptionAction,$('tab-recorrentes').children[1]);
      renderIncome();
      window.addEventListener('focus',()=>{if(WalletPrivacy.ready())renderAll();});
      const baseEnter=enterApp;enterApp=(...args)=>{baseEnter(...args);if(AppState.data.avisosAtivos&&WalletPrivacy.ready()){const count=WalletFeatures.summaryInsights().overdue.length;if(count)showToast(`${count} compromisso(s) vencido(s) pendente(s).`);}};
  });
})();
