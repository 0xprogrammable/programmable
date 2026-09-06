import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { REPOSITORY_ROOT } from './build.mjs';
import { canonicalJson, hash, need } from './core.mjs';

export async function journalDirectory(directory) {
  need(path.isAbsolute(directory), 'Journal directory must be absolute and owner controlled');
  const physical = await realpath(directory); const info = await lstat(directory); const temporary = await realpath(os.tmpdir());
  need(physical === directory && info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o777) === 0o700, 'Journal requires a real owner-only 0700 directory');
  for (const forbidden of [REPOSITORY_ROOT, temporary, '/private/tmp', '/tmp', '/var/tmp']) need(directory !== forbidden && !directory.startsWith(`${forbidden}/`), 'Journal must be outside the repository and temporary directories');
  return directory;
}
function filename(directory, planDigest, stage, suffix) { hash(planDigest); need(Number.isSafeInteger(stage) && stage >= 0 && stage < 64, 'Invalid journal stage'); return path.join(directory, `${planDigest}-${stage}.${suffix}.json`); }
async function readProtected(file) {
  try {
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { const info = await handle.stat(); need(info.isFile() && info.nlink === 1 && info.uid === process.getuid() && (info.mode & 0o777) === 0o600 && info.size < 1024 * 1024, 'Invalid protected journal file'); return JSON.parse(await handle.readFile('utf8')); }
    finally { await handle.close(); }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function appendOnce(file, value) {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(`${canonicalJson(value)}\n`, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  const directory = await open(path.dirname(file), constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
}
export async function journalEntry(directory, planDigest, stage) {
  await journalDirectory(directory);
  const requested = await readProtected(filename(directory, planDigest, stage, 'request'));
  if (!requested) return null;
  need(requested.planDigest === planDigest && requested.stepIndex === stage, 'Journal request identity differs');
  const recorded = await readProtected(filename(directory, planDigest, stage, 'transaction'));
  if (recorded) need(recorded.planDigest === planDigest && recorded.stepIndex === stage, 'Journal transaction identity differs');
  return { ...requested, transactionHash: recorded?.transactionHash ?? null };
}
/** Durable exclusive write happens BEFORE returning an EIP-1193 request to the browser. Never overwrites. */
export async function armJournal(directory, prepared, authority) {
  await journalDirectory(directory);
  await appendOnce(filename(directory, prepared.planDigest, prepared.stepIndex, 'request'), { ...prepared, authority, state: 'wallet-requested-outcome-unknown' });
}
export async function recordTransaction(directory, planDigest, stage, transactionHash) {
  hash(transactionHash); const entry = await journalEntry(directory, planDigest, stage); need(entry, 'No armed wallet request');
  if (entry.transactionHash) { need(entry.transactionHash === transactionHash, 'A different transaction is already recorded'); return entry; }
  await appendOnce(filename(directory, planDigest, stage, 'transaction'), { planDigest, stepIndex: stage, transactionHash });
  return journalEntry(directory, planDigest, stage);
}
export async function recordReceipt(directory, planDigest, stage, evidence) {
  need(evidence.status === 'included-code-verified-unfinalized', 'Only a verified included receipt can be recorded');
  const file = filename(directory, planDigest, stage, 'receipt'); const previous = await readProtected(file);
  if (previous) { need(canonicalJson(previous) === canonicalJson(evidence), 'Receipt evidence changed'); return; }
  await appendOnce(file, evidence);
}
