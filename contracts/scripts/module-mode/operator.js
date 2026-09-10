'use strict';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name=operator-token]').content;
let state, provider, prepared;
const names = { tokenFactory: 'Token factory', positionPlanner: 'Liquidity planner', launchPolicy: 'Launch policy', positionForwarderFactory: 'Locked position factory', registry: 'Module registry', runtimeFactory: 'Runtime factory', swapRouterFactory: 'Router factory', hook: 'Native Module Mode hook', launcher: 'Module Mode launcher', host: 'Module engine host', rewardFactory: 'Buyer reward factory', capFactory: 'Wallet cap factory' };
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
function recovery(transactionHash) {
  freezeRequest(); const canRetry = state.canRetry && !transactionHash;
  $('connect').hidden = !canRetry; $('prepare').hidden = true; $('retry').hidden = !canRetry; $('recovery').hidden = false;
  $('next-title').textContent = canRetry ? 'Review the exact retry' : 'Check the wallet outcome';
  $('next-copy').textContent = canRetry ? 'The owner requested another attempt. Its nonce, addresses, value, data and fee limits must match the stored request.' : 'Check MetaMask activity and record the transaction hash if one is available.';
  $('recovery-copy').textContent = canRetry ? 'The original request stays in the journal. Fresh source and provider checks are required before this separate retry.' : 'A wallet handoff is recorded. This tool will not automatically send it again.';
  if (transactionHash) { $('txhash').value = transactionHash; $('known-hash').textContent = transactionHash; }
}
async function load() {
  state = await api('/state'); $('stage').textContent = `Deployment ${state.stepIndex + 1} of ${state.totalSteps}`; $('title').textContent = names[state.role] || state.role;
  for (const [id, value] of Object.entries({ target: state.target, recipient: state.transactionRecipient, commit: state.sourceCommit, digest: state.planDigest, 'operator-commit': state.uiCheck ? 'Local preview; source authority not asserted' : state.operatorSourceCommit, initcode: state.initcodeHash, runtime: state.runtime.runtimeCodeHash })) $(id).textContent = value;
  if (state.sourceVersion === 'module-engine-any-quote-v1' && state.planSchema === 'programmable.module-engine-any-quote-deployment-plan.v1') {
    $('title').textContent = state.role === 'nativeRouteGuard' ? 'Any Quote route guard' : 'Any Quote host and shared hook';
    $('recipient').textContent = state.transactionRecipient ?? `Contract creation at wallet nonce ${state.reservedNonce}`;
    $('minimum-row').hidden = true;
    $('economics-summary').textContent = 'Every Any Quote pool credits the complete fixed 30 bps to the platform recipient in its quote asset. Separate creator fees are fixed at launch from 0 to 1,000 bps. The pool LP fee is zero. External conversion fees and gas are separate.';
    for (const [label, wallet] of [['Deployer · pays gas', state.owner], ['Review authority', state.parameters.reviewAuthority], ['30 bps recipient', state.economics.platformRecipient], ['Future reward recipient admin', state.economics.rewardAdmin]]) row($('wallets'), label, wallet);
    $('quote-dependencies').hidden = false;
    for (const [role, pin] of Object.entries(state.anyQuoteInfrastructure)) {
      row($('quote-pins'), `${role} address`, pin.address); row($('quote-pins'), `${role} runtime hash`, pin.runtimeCodeHash);
    }
  } else if (state.sourceVersion === 'module-engine-quote-v1' && state.planSchema === 'programmable.module-engine-quote-deployment-plan.v1') {
    $('title').textContent = state.role === 'positionPlanner' ? 'Quote liquidity planner' : 'Quote to ETH converter';
    $('minimum-row').hidden = true; $('wallets-title').textContent = 'Gas payer'; row($('wallets'), 'Deployer · pays gas', state.owner);
    $('economics-summary').textContent = 'This step deploys shared liquidity or fee conversion infrastructure. Neither contract has administrative permissions. Template approval and publication require separate reviews.';
    const labels = { positionPlanner: 'Quote liquidity planner', converter: 'Quote to ETH converter', poolManager: 'V4 PoolManager',
      positionManager: 'V4 PositionManager', positionForwarderFactory: 'Locked position factory', deterministicDeployer: 'CREATE2 deployer',
      v3Factory: 'V3 factory', router: 'SwapRouter02', weth: 'Wrapped ETH' };
    $('quote-dependencies').hidden = false;
    for (const [role, pin] of Object.entries({ ...state.quoteInfrastructure.contracts, ...state.quoteInfrastructure.dependencies })) {
      row($('quote-pins'), `${labels[role]} address`, pin.address); row($('quote-pins'), `${labels[role]} runtime hash`, pin.runtimeCodeHash);
    }
  } else {
    if (state.sourceVersion === 'module-engine-v1') $('minimum-row').hidden = true;
    else $('minimum').textContent = `${eth(state.parameters.minimumInitialBuyNative)} gross, plus gas`;
    if (state.sourceVersion === 'module-native-v2' || state.sourceVersion === 'module-engine-v1') $('economics-summary').textContent = 'Without eligible module families, the protocol fee is 10 bps. With eligible families, the fee is 30 bps: 10 bps for the protocol and 20 bps shared by those families. Creator fees are additional.';
    for (const [label, wallet] of [['Deployer · pays gas', state.owner], ['Review authority', state.parameters.reviewAuthority], ['Treasury', state.economics.treasury], ['CTO fee admin', state.economics.rewardAdmin]]) row($('wallets'), label, wallet);
  }
  const dl = document.createElement('dl'); dl.className = 'facts'; state.constructorInputs.forEach((input, i) => row(dl, `${input.name} (${input.type})`, JSON.stringify(state.constructorValues[i]))); if (!state.constructorInputs.length) row(dl, 'Constructor', 'No arguments'); $('constructor').append(dl);
  if (state.uiCheck) { $('mode').textContent = 'UI check only. Wallet requests, RPC calls and journal writes are disabled.'; $('connect').hidden = true; $('prepare').textContent = 'Review deployment details'; $('next-copy').textContent = 'Inspect the actual prepared constructor and source commitments. This preview cannot send a transaction.'; }
  else { $('mode').textContent = `Exact production operator source and hosted Verify run ${state.authority.runId} bound. Wallet confirmation remains yours.`; if (state.journalState !== 'not-requested') recovery(state.transactionHash); }
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
async function prepare(retry = false) {
  if (state.uiCheck) { $('technical').open = true; $('technical').querySelector('summary').focus(); status('These are unsigned preparation details. No wallet was accessed.'); return; }
  const button = $(retry ? 'retry' : 'prepare'); button.disabled = true; freezeRequest(); try { await walletMatches(); status('Checking source, both providers, nonce, gas and balance…'); prepared = await api(retry ? '/prepare-retry' : '/prepare');
    $('maximum').textContent = `${eth(BigInt(prepared.request.gas) * BigInt(prepared.request.maxFeePerGas))} maximum`;
    $('request').textContent = JSON.stringify(prepared.request, null, 2); $('request-details').hidden = false; $('confirmation').hidden = false;
    status(retry ? 'Simulation passed. The wallet payload matches the original request exactly. Review its maximum cost again.' : 'Simulation passed. Review the exact wallet request and maximum cost.');
  } catch (e) { error(e); } finally { button.disabled = false; }
}
$('prepare').onclick = () => prepare();
$('retry').onclick = () => prepare(true);
$('reviewed').onchange = () => { $('send').disabled = !prepared || !$('reviewed').checked; };
$('send').onclick = async () => { $('send').disabled = true; let armAttempted = false; try {
  if (state.uiCheck || !prepared || !$('reviewed').checked) throw new Error('Review a fresh request first.');
  const reviewed = prepared; await walletMatches();
  if (prepared !== reviewed || !$('reviewed').checked) throw new Error('The wallet changed. Review a fresh request first.');
  status('Rechecking before wallet handoff…'); armAttempted = true;
  const response = await api(reviewed.retryAttempt ? '/arm-retry' : '/arm', { requestDigest: reviewed.requestDigest });
  await walletMatches();
  if (prepared !== reviewed || !$('reviewed').checked) throw new Error('The wallet changed after recording the handoff. Check its outcome before retrying.');
  state.canRetry = false; recovery(); status('Confirm the exact deployment in MetaMask.');
  const txHash = await provider.request({ method: 'eth_sendTransaction', params: [response.request] });
  recovery(txHash); status('Wallet returned a transaction hash. Recording it now…'); await api('/record', { transactionHash: txHash }); status('Transaction recorded. Check its receipt and deployed code.');
} catch (e) {
  if (!armAttempted) { freezeRequest(); error(e); return; }
  state.canRetry = false; recovery();
  try {
    state = await api('/state');
    if (state.journalState === 'not-requested' && !state.actionInProgress) {
      $('recovery').hidden = true; $('connect').hidden = false; $('prepare').hidden = false;
      status('No wallet handoff was recorded. Resolve the error, then simulate again.'); error(e); return;
    }
    recovery(state.transactionHash);
  } catch { /* An unavailable journal leaves the handoff frozen. */ }
  const reason = e.code === 4001 ? 'MetaMask did not return a transaction hash.' : String(e.message || e).slice(0, 500);
  error(new Error(`${reason} Check MetaMask activity and record any transaction hash. The stored request will not be sent again automatically.`));
} };
$('record').onclick = async () => { try { const value = await api('/record', { transactionHash: $('txhash').value.trim() }); $('known-hash').textContent = value.transactionHash; status('Transaction hash recorded.'); } catch (e) { error(e); } };
$('receipt').onclick = async () => { $('receipt').disabled = true; try { status('Checking transaction inclusion and exact deployed code with both providers…'); const value = await api('/receipt'); status(value.status === 'pending' ? 'Transaction is still pending.' : 'Receipt and complete runtime code verified. Ethereum finality and source publication remain separate.'); } catch (e) { error(e); } finally { $('receipt').disabled = false; } };
load().catch(error);
