import { canonicalJson, digest, need } from '../module-mode/core.mjs';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { anyQuoteBasis } from './any-quote-basis.mjs';
import { engineWire } from './shared.mjs';

// Previously included and source-verified foundation. This is reuse provenance, not activation.
export const ANY_QUOTE_ETH_GUARD_RELEASE = Object.freeze({
  "chainId": 4663,
  "contracts": {
    "host": {
      "address": "0xfc4752006da554f086ba75a336b3525b9de5ce1d",
      "runtimeCodeHash": "0xb793455747d315c40c77431556f653bd3cafb0d2adb55218e87baa735ed02313"
    },
    "launchPolicy": {
      "address": "0xf3ff250759a66edc7893bba9d34daf4ba4ae4caa",
      "runtimeCodeHash": "0x1c485a64c77174e0b2a78adf2527128792180def26cbab2ca00fcfa74b73ba91"
    },
    "ledger": {
      "address": "0xc6ec7c1b2edd91183e967a21c944d3dd6ff9a084",
      "runtimeCodeHash": "0x04274a9f3daacee275f86fc2fdf817bd11a777c029d0990a3ffc51825eaba640"
    },
    "nativeRouteGuard": {
      "address": "0x92c1d5735a89488a77841634c48d922cd3f2c0e4",
      "runtimeCodeHash": "0x704f8f3c1903e1f15dd041b2dd29673a8c98bee9c87f645da90978c2315cf4ee"
    },
    "poolManager": {
      "address": "0x8366a39cc670b4001a1121b8f6a443a643e40951",
      "runtimeCodeHash": "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626"
    },
    "registry": {
      "address": "0x0082094ebeb3817cd78b2bc3725ca23b5720d884",
      "runtimeCodeHash": "0x364028382d38d4d1d4994ad305e0538f72ef2f2360a0f671ae82912c44374fdd"
    },
    "sharedHook": {
      "address": "0xcf533f717b787f6eb591498411aef8231366a0cc",
      "runtimeCodeHash": "0x67720ca20962ddc3762c63d98b2dd900e268fc9ccc4b4306528ac09f630b12fa"
    },
    "tokenFactory": {
      "address": "0x754e8c1ade3c6c4c863590a91f2ed020baf8e779",
      "runtimeCodeHash": "0x9354ef051bafa1edccb95c91d999e31025c012ee8d93392a78a51d83594845f2"
    },
    "universalRouter": {
      "address": "0x06afba43fd06227fa663b0daecf536f6eaa6bf99",
      "runtimeCodeHash": "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5"
    }
  },
  "economicsPolicyId": "0xe5028630113d178a49b8fce74f39ed7b326081772695f9e3e2ffaacee81f504d",
  "engineProfile": "robinhood-any-quote.shared-hook.v1",
  "finalityPolicy": "robinhood-ethereum-finalized-v1",
  "schemaVersion": "programmable.module-engine.release.v1",
  "sourceCommit": "9824c23ca4954fde8b5f4861f2a537fd0600bbf7",
  "sourceVersion": "module-engine-any-quote-v1",
  "tokenCreationCodeHash": "0x445809d9f7a34e959de4a96dec1e1beddfb265755bf28c57c42744adea1128ef",
  "startBlock": "59807048",
  "releaseDigest": "0xac96d652e2043f34b3f736bad999ab673b17aa8750b5d62951e9ec928306273d",
  "sourceVerificationDigest": "0xfc3a5a5b18a85e9b9718c994b03c23bd073db6be3cdd31112b8de179a2903ea7"
});
export async function anyQuoteEthBasis(root = REPOSITORY_ROOT) {
  const base = await anyQuoteBasis(root), { sourceVerificationDigest, ...identity } = ANY_QUOTE_ETH_GUARD_RELEASE;
  (await engineWire()).bindModuleEngineReleaseIdentity(identity);
  const { basisDigest: _oldDigest, ...body } = base;
  body.guardRelease = ANY_QUOTE_ETH_GUARD_RELEASE;
  return { ...body, basisDigest: digest(body.schemaVersion, body) };
}
export async function assertAnyQuoteEthBasis(basis, root = REPOSITORY_ROOT) {
  need(canonicalJson(basis) === canonicalJson(await anyQuoteEthBasis(root)), 'Native-fee retained source basis differs');
}
