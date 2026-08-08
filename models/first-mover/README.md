# First Mover

The first pool to actually trade a ticker owns it. Copies are allowed, and they pay the original.

## The problem

A token runs. Within hours, three more launch with the same name and the same ticker. Buyers cannot tell which is
which, some of the flow goes to the copies, and the token that did the work bleeds attention to tokens that did not.

Nothing on-chain distinguishes them. Both are ERC-20s with the same string in `symbol()`. "Which one is the original"
has no answer a contract can give, so it gets answered by whoever shouts loudest.

First Mover gives it an answer.

## What the model does

Launching registers the token's symbol, normalized, in a registry the hook owns.

**If the ticker is free**, the pool takes a *provisional* claim. The claim becomes permanent only once the pool has
accrued 0.1 ETH in creator fees, which at a 1.00% swap fee is roughly 10 ETH of volume. Registering costs nothing;
earning the ticker takes trading.

**If the ticker is already live**, the launch is not blocked. The model does not censor. The pool is recorded as a
derivative of the original and routes 20% of its own creator share to the original's reward vault for as long as the
original's claim stands.

**If a provisional claim is never earned**, it lapses after roughly seven days and the ticker frees up.

## Why claims must be earned

If registering were enough, the first hour of this model's life would be a script claiming every desirable ticker on
Ethereum. "First mover" would mean "fastest bot", and the registry would be worse than useless because it would
certify squatters as originals.

Requiring real accrued fees makes farming uneconomic. A squatter would have to generate genuine volume on every
ticker they wanted to hold, which is the same as launching a real token.

## What a trader sees

Nothing changes. A derivative charges the same total fee as any other pool, and Programmable's 0.10% and the
builder's 0.10% are identical. Tribute is a redistribution of the creator's own share.

What changes is that an interface can now ask the chain `isOriginal(poolId)` and get a straight answer, with the
block the claim was taken.

## Bounds

| Parameter | Value |
| --- | --- |
| Confirmation threshold | 0.1 ETH of accrued creator fees |
| Grace window | 50,400 blocks, about seven days |
| Tribute | 20% of a derivative's creator share |
| Symbol length | 1 to 32 bytes |
| Swap fee | Classic's bounds: 1.00% to 10.00% in whole-percent steps, per direction |

## What it does not do

- **It cannot stop copies existing.** Anyone can deploy any ERC-20 with any symbol. This model settles who the
  original is inside Programmable's catalog; it does not reach tokens launched elsewhere.
- **It only folds ASCII case.** `PEPE`, `pepe` and `Pepe` are one ticker. A symbol using Cyrillic or Greek
  lookalikes is a different ticker and will take its own claim. Homoglyph defence is an indexing problem, not one a
  contract can solve.
- **It does not judge quality.** A confirmed claim means "traded first", not "better".

## Risks

First Mover inherits every risk documented for Classic.

Beyond those: a well-capitalised actor can front-run a ticker by launching and generating the confirmation volume
themselves before the intended project launches. The threshold makes this cost real money at real risk, and the
claim block is public, but it is not prevented. See [SECURITY.md](SECURITY.md).
