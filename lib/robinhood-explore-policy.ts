// Website display policy only. Canonical launch records are never removed here.
export const PINNED_ROBINHOOD_TOKEN = "0xc60ba256b44334a0cd2c7242e98b88f031abb006";

const HIDDEN_ROBINHOOD_TOKENS = new Set([
  "0x15fca474b23cafe775120b1fafbcff0e7a827af2", // Robinhood Clean Room
  // Native V1 release lifecycle canaries.
  "0x624a052063f4a1c88a33305502a409fe619a9c40", // MMPLAIN
  "0xfcad8c39996f9d81b5d343e59d9112b61faf6fc4", // MMREWARD
  "0xdafa970bc01cbdf131fa7d5430478f9a5d1e451a", // MMMODS release canary
  // Native V2 release lifecycle canaries.
  "0xbf993e56a0259300d45cf2385ddb7d12cdfa340f", // M53P
  "0xf364cbe8a0019c61f03b4cf1180153966fd8f9a2", // M53C
  // Engine V1 release lifecycle canaries.
  "0xaa86dd7c149d8220a5a90028620a0e1b2a75f261", // M53GEN
  "0xab980c9b4d538b2101e9434abe39cf978dea601d", // M53GUSDG
  "0x08bdedb48ee01f29dd88e84e6d9296e84d736aa2", // M53FIX
  "0xdf23dac67139ebd3f66fcc4ea224c5c6ae850546", // M53SET
  "0xd9320af2762e711918358422594684756ad760cc", // PN20REF backfill canary
  "0xb36271399c031ce270e0d1eed5f26dcd08367119", // AQLPTEST Any Quote LP release canary
  "0x6dcad5b2373963a677d8e0e2d7dcafea192ea41b", // Native ETH Any Quote release canary
  "0x987de464bde48979ef92592e196cadb926602768", // AQINIT20 atomic initial-buy canary
]);

export function isVisibleRobinhoodToken(address: string) {
  return !HIDDEN_ROBINHOOD_TOKENS.has(address.toLowerCase());
}

export function isPinnedRobinhoodToken(address: string) {
  return address.toLowerCase() === PINNED_ROBINHOOD_TOKEN;
}
