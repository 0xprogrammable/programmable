'use strict';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name=operator-token]').content;
let state, provider, prepared;
function eth(value) { const n = BigInt(value), fraction = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, ''); return `${n / 10n ** 18n}${fraction ? `.${fraction}` : ''} ETH`; }
async function api(route, input = {}) { const response = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-module-operator-token': token }, body: JSON.stringify(input) }); const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Operator request failed'); return value; }
function status(message) { $('status').textContent = message; $('error').textContent = ''; }
function error(value) { $('error').textContent = value.message || String(value); }
function row(container, label, value, id) { const div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; dd.className = 'mono'; if (id) dd.id = id; div.append(dt, dd); container.append(div); }
function freeze() { prepared = null; $('confirmation').hidden = true; $('reviewed').checked = false; $('send').disabled = true; }
async function walletMatches() { if (!provider) throw new Error('Connect MetaMask first.'); const accounts = await provider.request({ method: 'eth_accounts' }), chain = await provider.request({ method: 'eth_chainId' }); if (chain.toLowerCase() !== '0x1237' || accounts[0]?.toLowerCase() !== state.owner) throw new Error('Select the exact reviewed wallet on Robinhood Chain 4663.'); }
function recovery(hash) { freeze(); $('recovery').hidden = false; $('prepare').hidden = true; $('retry').hidden = !state.canRetry || Boolean(hash); $('connect').hidden = $('retry').hidden; if (hash) { $('txhash').value = hash; $('known-hash').textContent = hash; } }
async function load() {
  state = await api('/state'); $('stage').textContent = `Operation ${state.stepIndex + 1} of ${state.totalSteps}`; $('title').textContent = state.step.label;
  for (const [label, value] of [['Wallet · pays value and gas', state.owner], ['Transaction recipient', state.step.to], ['Resulting contract or token', state.step.target], ['Function', state.step.functionName], ['ETH sent', eth(state.step.value)]]) row($('facts'), label, value);
  row($('facts'), 'Maximum gas cost', 'Fresh simulation required', 'maximum');
  for (const [label, value] of [['Contract source', state.contractSourceCommit], ['Operator source', state.sourceCommit], ['Immutable release', state.releaseDigest], ['Operation plan', state.planDigest]]) row($('sources'), label, value);
  $('arguments').textContent = JSON.stringify(state.step.arguments, null, 2);
  if (state.uiCheck) { $('mode').textContent = 'Preview only. Wallet, provider and journal access are disabled.'; $('connect').hidden = true; $('prepare').textContent = 'Review operation details'; }
  else { $('mode').textContent = `Exact production source and hosted Verify run ${state.authority.runId} bound. Final wallet confirmation is yours.`; if (state.journalState !== 'not-requested') recovery(state.transactionHash); }
}
$('connect').onclick = async () => { try {
  if (state.uiCheck) throw new Error('Wallet access is disabled.'); const candidates = window.ethereum?.providers ?? (window.ethereum ? [window.ethereum] : []);
  provider = candidates.find(item => item.isMetaMask && !item.isBraveWallet && !item.isCoinbaseWallet); if (!provider) throw new Error('Open this page in a browser with MetaMask.');
  await provider.request({ method: 'eth_requestAccounts' }); await walletMatches();
  provider.on?.('accountsChanged', () => { freeze(); status('Wallet changed. Review this operation again.'); }); provider.on?.('chainChanged', () => { freeze(); status('Network changed. Review this operation again.'); });
  $('wallet-status').textContent = state.owner; status('Reviewed wallet connected.');
} catch (e) { error(e); } };
async function prepare(retry) {
  if (state.uiCheck) { $('technical').open = true; $('technical').querySelector('summary').focus(); return; }
  const button = $(retry ? 'retry' : 'prepare'); button.disabled = true; freeze();
  try { await walletMatches(); status('Checking review, providers, current state, balance and gas…'); prepared = await api(retry ? '/prepare-retry' : '/prepare');
    $('maximum').textContent = eth(BigInt(prepared.request.gas) * BigInt(prepared.request.maxFeePerGas)); $('request').textContent = JSON.stringify(prepared.request, null, 2);
    $('simulation').textContent = JSON.stringify(prepared.observation.simulatedResult, null, 2); $('request-details').hidden = false; $('confirmation').hidden = false;
    status('Simulation passed. Review the exact request, ETH value and maximum gas cost.');
  } catch (e) { error(e); } finally { button.disabled = false; }
}
$('prepare').onclick = () => prepare(false); $('retry').onclick = () => prepare(true);
$('reviewed').onchange = () => { $('send').disabled = !prepared || !$('reviewed').checked; };
$('send').onclick = async () => {
  $('send').disabled = true; let armAttempted = false;
  try {
    if (state.uiCheck || !prepared || !$('reviewed').checked) throw new Error('Review a fresh request first.'); const reviewed = prepared; await walletMatches();
    if (prepared !== reviewed || !$('reviewed').checked) throw new Error('Wallet changed. Review again.'); status('Rechecking before the durable wallet handoff…'); armAttempted = true;
    const response = await api('/arm', { requestDigest: reviewed.requestDigest }); await walletMatches();
    if (prepared !== reviewed || !$('reviewed').checked) throw new Error('Wallet changed after handoff; reconcile the recorded request.');
    state.canRetry = false; recovery(); status('Confirm this exact operation in MetaMask.');
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [response.request] }); recovery(hash); await api('/record', { transactionHash: hash }); status('Transaction recorded. Check its receipt and state.');
  } catch (e) {
    if (!armAttempted) { freeze(); error(e); return; } state.canRetry = false; recovery();
    try { state = await api('/state'); if (state.journalState === 'not-requested' && !state.actionInProgress) { $('recovery').hidden = true; $('connect').hidden = false; $('prepare').hidden = false; status('No wallet handoff was recorded. Resolve the error and simulate again.'); error(e); return; } recovery(state.transactionHash); } catch { /* An unavailable journal keeps the handoff frozen. */ }
    error(new Error(`${String(e.message || e).slice(0, 500)} Check MetaMask activity and record any actual hash. The stored request is not sent again automatically.`));
  }
};
$('record').onclick = async () => { try { const value = await api('/record', { transactionHash: $('txhash').value.trim() }); $('known-hash').textContent = value.transactionHash; status('Actual hash recorded.'); } catch (e) { error(e); } };
$('receipt').onclick = async () => { $('receipt').disabled = true; try { status('Checking canonical inclusion, runtime and operation state with both providers…'); const value = await api('/receipt'); status(value.status === 'pending' ? 'Transaction is still pending.' : 'Receipt, runtime and operation state verified. Ethereum finality is still a separate check.'); } catch (e) { error(e); } finally { $('receipt').disabled = false; } };
load().catch(error);
