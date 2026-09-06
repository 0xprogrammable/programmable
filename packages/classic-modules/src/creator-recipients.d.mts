import type { Hex, UintInput } from './index.mjs';

export const MAX_CREATOR_SPLIT_RECIPIENTS: 1000;
export const CREATOR_SPLIT_DOMAIN: Hex;
export interface CreatorSplitRecipientInput { wallet: Hex; shareBps: UintInput }
export interface CreatorSplitRecipient {
  index: string; wallet: Hex; shareBps: string; leaf: Hex; proof: Hex[];
}
export interface CreatorSplit {
  format: 'programmable.classic.creator-split.v1'; root: Hex; recipientCount: number;
  /** Sorted address20 + big-endian uint16 shareBps, exactly 22 bytes per recipient. */
  allocations: Hex; recipients: CreatorSplitRecipient[];
}
export interface CreatorTakeoverInput {
  ledger: Hex; poolId: Hex; newWallets: readonly Hex[]; expectedAdminRevision: UintInput; deadline: UintInput;
}
export interface PreparedCreatorTakeover { target: Hex; data: Hex; value: '0' }
/** Builds immutable allocations and proofs; deployment and wallet authorization remain separate. */
export function buildCreatorSplit(recipients: readonly CreatorSplitRecipientInput[]): CreatorSplit;
/** Preserves slot order and shares; caller supplies a freshly read admin revision and a deadline. */
export function encodeCreatorTakeover(input: CreatorTakeoverInput): PreparedCreatorTakeover;
