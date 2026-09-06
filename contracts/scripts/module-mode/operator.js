'use strict';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name=operator-token]').content;
let state, provider, prepared;
const names = { tokenFactory: 'Token factory', positionPlanner: 'Liquidity planner', launchPolicy: 'Launch policy', positionForwarderFactory: 'Locked position factory', registry: 'Module registry', runtimeFactory: 'Runtime factory', swapRouterFactory: 'Router factory', hook: 'Native Module Mode hook', launcher: 'Module Mode launcher', rewardFactory: 'Buyer reward factory', capFactory: 'Wallet cap factory' };
function eth(value) { const n = BigInt(value), fraction = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, ''); return `${n / 10n ** 18n}${fraction ? `.${fraction}` : ''} ETH`; }
async function api(route, input = {}) { const response = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-module-operator-token': token }, body: JSON.stringify(input) }); const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Operator request failed'); return value; }
function status(message) { $('status').textContent = message; $('error').textContent = ''; }
function error(error) { $('error').textContent = error.message || String(error); }
function row(container, label, value) { const div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; dd.className = 'mono'; div.append(dt, dd); container.append(div); }
function freezeRequest() { prepared = null; $('confirmation').hidden = true; $('reviewed').checked = false; $('send').disabled = true; }
async function walletMatches() {
  if (!provider) throw new Error('Connect MetaMask first.');
  const accounts = await provider.request({ method: 'eth_accounts' }); const chain = await provider.request({ method: 'eth_chainId' });
  if (chain.toLowerCase() !== '0x1237') throw new Error('Select Robinhood Chain 4663 in MetaMask.');
  if (!accounts[0] || accounts[0].toLowerCase() !== state.owner) throw new Error('Select the exact reviewed deployer in MetaMask.');
  return accounts[0];
}
function recovery(transactionHash) { freezeRequest(); $('connect').hidden = true; $('prepare').hidden = true; $('recovery').hidden = false; if (transactionHash) { $('txhash').value = transactionHash; $('known-hash').textContent = transactionHash; } }
async function load() {
  state = await api('/state'); $('stage').textContent = `Deployment ${state.stepIndex + 1} of ${state.totalSteps}`; $('title').textContent = names[state.role] || state.role;
  for (const [id, value] of Object.entries({ target: state.target, recipient: state.transactionRecipient, commit: state.sourceCommit, digest: state.planDigest, initcode: state.initcodeHash, runtime: state.runtime.runtimeCodeHash })) $(id).textContent = value;
  $('minimum').textContent = `${eth(state.parameters.minimumInitialBuyNative)} gross, plus gas`;
  for (const [label, wallet] of [['Deployer · pays gas', state.owner], ['Review authority', state.parameters.reviewAuthority], ['Treasury', state.economics.treasury], ['CTO fee admin', state.economics.rewardAdmin]]) row($('wallets'), label, wallet);
  const dl = document.createElement('dl'); dl.className = 'facts'; state.constructorInputs.forEach((input, i) => row(dl, `${input.name} (${input.type})`, JSON.stringify(state.constructorValues[i]))); if (!state.constructorInputs.length) row(dl, 'Constructor', 'No arguments'); $('constructor').append(dl);
  if (state.uiCheck) { $('mode').textContent = 'UI check only. Wallet requests, RPC calls and journal writes are disabled.'; $('connect').hidden = true; $('prepare').textContent = 'Review deployment details'; $('next-copy').textContent = 'Inspect the actual prepared constructor and source commitments. This preview cannot send a transaction.'; }
  else { $('mode').textContent = `Exact production source and hosted Verify run ${state.authority.runId} bound. Wallet confirmation remains yours.`; if (state.journalState !== 'not-requested') recovery(state.transactionHash); }
}
$('connect').onclick = async () => { try {
  if (state.uiCheck) throw new Error('Wallet access is disabled in UI check mode.');
  const candidates = window.ethereum?.providers ?? (window.ethereum ? [window.ethereum] : []); provider = candidates.find(item => item.isMetaMask && !item.isBraveWallet && !item.isCoinbaseWallet);
  if (!provider) throw new Error('Open this local page in a browser with MetaMask installed.');
  await provider.request({ method: 'eth_requestAccounts' }); await walletMatches();
  provider.on?.('accountsChanged', () => { freezeRequest(); status('Wallet changed. Review this step again.'); });
  provider.on?.('chainChanged', () => { freezeRequest(); status('Network changed. Review this step again.'); });
  $('wallet-status').textContent = `Connected: ${state.owner}`; status('Reviewed deployer connected to Robinhood.');
} catch (e) { error(e); } };
$('prepare').onclick = async () => { if (state.uiCheck) { $('technical').open = true; $('technical').querySelector('summary').focus(); status('These are unsigned preparation details. No wallet was accessed.'); return; }
  $('prepare').disabled = true; freezeRequest(); try { await walletMatches(); status('Checking source, both providers, nonce, gas and balance…'); prepared = await api('/prepare');
    $('maximum').textContent = `${eth(BigInt(prepared.request.gas) * BigInt(prepared.request.maxFeePerGas))} maximum`;
    $('request').textContent = JSON.stringify(prepared.request, null, 2); $('request-details').hidden = false; $('confirmation').hidden = false; status('Simulation passed. Review the exact wallet request and maximum cost.');
  } catch (e) { error(e); } finally { $('prepare').disabled = false; } };
$('reviewed').onchange = () => { $('send').disabled = !prepared || !$('reviewed').checked; };
$('send').onclick = async () => { $('send').disabled = true; let armed = false; try {
  if (state.uiCheck || !prepared || !$('reviewed').checked) throw new Error('Review a fresh request first.');
  await walletMatches(); status('Rechecking before wallet handoff…'); armed = true; const response = await api('/arm', { requestDigest: prepared.requestDigest });
  await walletMatches(); status('Confirm the exact deployment in MetaMask.'); const txHash = await provider.request({ method: 'eth_sendTransaction', params: [response.request] });
  recovery(txHash); status('Wallet returned a transaction hash. Recording it now…'); await api('/record', { transactionHash: txHash }); status('Transaction recorded. Check its receipt and deployed code.');
} catch (e) { if (armed) { recovery(); error(new Error('The handoff may have been recorded. Reopen this operator to check its journal, then check MetaMask activity and record any transaction hash. This step will not be sent again automatically.')); } else error(e); } };
$('record').onclick = async () => { try { const value = await api('/record', { transactionHash: $('txhash').value.trim() }); $('known-hash').textContent = value.transactionHash; status('Transaction hash recorded.'); } catch (e) { error(e); } };
$('receipt').onclick = async () => { $('receipt').disabled = true; try { status('Checking transaction inclusion and exact deployed code with both providers…'); const value = await api('/receipt'); status(value.status === 'pending' ? 'Transaction is still pending.' : 'Receipt and complete runtime code verified. Ethereum finality and source publication remain separate.'); } catch (e) { error(e); } finally { $('receipt').disabled = false; } };
load().catch(error);
