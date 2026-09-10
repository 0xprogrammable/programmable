import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { keccak256 } from "viem";

const root = resolve(import.meta.dirname, "../..");
const contracts = resolve(root, "contracts");
const script = resolve(import.meta.dirname, "any-quote-route-runtime.test.mjs");

// Foundry calls the real TypeScript compiler with the token/hook addresses produced by its
// real host fixture. This prevents a separately handwritten Solidity route from passing while
// the browser compiler emits different bytes.
if (process.argv[2] === "encode") {
  const bundle = await build({ absWorkingDir: root, stdin: { contents: "export * from './lib/module-engine/any-quote/route'; export * from './lib/module-engine/any-quote/types';", resolveDir: root }, bundle: true, format: "cjs", platform: "node", packages: "external", write: false });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), loadedModule, loadedModule.exports);
  const a = loadedModule.exports;
  const [token, quote, hook, owner, side, amount, minimum, nowText, kind] = process.argv.slice(3);
  const now = BigInt(nowText), buy = side === "buy";
  const key = { currency0: a.ANY_QUOTE_NATIVE, currency1: quote, fee: 3000, tickSpacing: 60, hooks: a.ANY_QUOTE_NATIVE };
  const moduleKey = { currency0: BigInt(token) < BigInt(quote) ? token : quote, currency1: BigInt(token) < BigInt(quote) ? quote : token, fee: 0, tickSpacing: 200, hooks: hook };
  const built = a.buildAnyQuoteSwapV1({ pool: { token, quoteAsset: quote, sharedHook: hook, poolId: a.anyQuotePoolIdV1(moduleKey) }, owner, recipient: owner, side, amountIn: BigInt(amount), minimumAmountOut: BigInt(minimum), now, deadline: now + 120n,
    externalRoute: { provider: "uniswap-trading-api", chainId: 4663, tokenIn: buy ? a.ANY_QUOTE_WETH : quote, tokenOut: buy ? quote : a.ANY_QUOTE_WETH, amountIn: amount, amountOut: "1", checkpoint: { number: "1", hash: `0x${"11".repeat(32)}`, timestamp: nowText }, validUntil: (now + 120n).toString(), evidenceHash: `0x${"11".repeat(32)}`,
      hops: [{ protocol: "V4", tokenIn: buy ? a.ANY_QUOTE_NATIVE : quote, tokenOut: buy ? quote : a.ANY_QUOTE_NATIVE, key, poolId: a.anyQuotePoolIdV1(key), hookData: "0x" }] } });
  process.stdout.write(kind === "operation" ? built.nativeBuyOperationData : built.transaction.data);
} else {
  test("real V4 host, pinned UR and Permit2 execute compiler bytes with donation independence and rollback", { timeout: 180_000 }, () => {
    const work = resolve(root, "work/any-quote-route-runtime");
    const out = resolve(work, "out");
    mkdirSync(work, { recursive: true });
    const permit2 = readFileSync(resolve(import.meta.dirname, "any-quote-route-permit2.hex"), "utf8").trim();
    const profile = JSON.parse(readFileSync(resolve(contracts, "spec/robinhood-custom-launch/chain-4663.v1.json"), "utf8"));
    assert.equal(keccak256(permit2), profile.contracts.uniswap.permit2.runtimeCodeHash);
    // Reuse the existing host's admission, immutables and source-size checks. Only fixture
    // helper visibility changes in this temporary test source; production source stays exact.
    const base = readFileSync(resolve(contracts, "test/module-engine/any-quote/ModuleEngineAnyQuoteHostV1.t.sol"), "utf8")
      .replaceAll('"../../../src/', '"src/')
      .replace('"./ModuleEngineAnyQuoteHostRouterFixture.sol"', '"test/module-engine/any-quote/ModuleEngineAnyQuoteHostRouterFixture.sol"')
      .replaceAll("private", "internal").replace("contract ModuleEngineAnyQuoteHostV1Test", "contract AnyQuoteRouteBase")
      .replaceAll("computeCreate2Address(", "vm.computeCreate2Address(").replaceAll("computeCreateAddress(", "vm.computeCreateAddress(")
      .replaceAll('"out/', `"${out}/`);
    const source = `${base}
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
interface IRoutePermit2 { function approve(address token, address spender, uint160 amount, uint48 expiry) external; }

contract AnyQuoteRouteRuntimeTest is AnyQuoteRouteBase {
    address internal constant QUOTE = 0xC60bA256B44334A0Cd2C7242E98B88f031abB006;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    AnyQuoteHostWethFixture internal quote;

    receive() external payable {}

    function seedExternal() internal {
        deployCodeTo("AnyQuoteHostWethFixture", QUOTE);
        quote = AnyQuoteHostWethFixture(QUOTE);
        quote.mint(address(this), 1000 ether);
        vm.deal(address(this), 1000 ether);
        vm.etch(PERMIT2, hex"${permit2.slice(2)}");
        assertEq(PERMIT2.codehash, bytes32(${profile.contracts.uniswap.permit2.runtimeCodeHash}));
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(QUOTE), 3000, 60, IHooks(address(0)));
        IPoolManager(MANAGER).initialize(key, uint160(1 << 96));
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(IPoolManager(MANAGER));
        quote.approve(address(lp), type(uint256).max);
        lp.modifyLiquidity{value: 1000 ether}(key, ModifyLiquidityParams(-600, 600, 10000 ether, bytes32(0)), "");
    }

    function encoded(address token, bool buy, uint256 amount, uint256 minimum, bool operation) internal returns(bytes memory) {
        string[] memory args = new string[](12);
        args[0] = "${process.execPath}"; args[1] = "${script}"; args[2] = "encode";
        args[3] = vm.toString(token); args[4] = vm.toString(QUOTE); args[5] = vm.toString(address(host.sharedHook()));
        args[6] = vm.toString(ALICE); args[7] = buy ? "buy" : "sell";
        args[8] = vm.toString(amount); args[9] = vm.toString(minimum); args[10] = vm.toString(block.timestamp);
        args[11] = operation ? "operation" : "transaction";
        return vm.ffi(args);
    }

    function nativeParams(uint256 salt, uint256 amount, uint256 minimum) internal returns(Host.LaunchParameters memory p) {
        p = _params(salt); p.quoteAsset = QUOTE;
        (address token,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        p.configuration = abi.encode(A.Configuration(A.SCHEMA_ID, MANAGER, MANAGER.codehash, address(host.sharedHook()), QUOTE,
            QUOTE < token ? int24(120000) : int24(-120000), uint64(block.timestamp + 180), keccak256("route runtime price fixture")));
        p.initialOperation = T.Operation(host.NATIVE_BUY(), ALICE, ALICE, address(0), amount, token, minimum,
            block.timestamp + 120, 0, encoded(token, true, amount, minimum, true));
    }

    function launchNative(uint256 salt) internal returns(Host.Launch memory) {
        Host.LaunchParameters memory p = nativeParams(salt, 1 ether, 1);
        vm.prank(ALICE); return host.launch{value: 1 ether}(p);
    }

    function sell(address token, uint256 amount, uint256 minimum) internal returns(uint256 outAmount) {
        bytes memory data = encoded(token, false, amount, minimum, false);
        vm.startPrank(ALICE);
        if (IERC20(token).allowance(ALICE, PERMIT2) < amount) IERC20(token).approve(PERMIT2, amount);
        IRoutePermit2(PERMIT2).approve(token, ROUTER, uint160(amount), uint48(block.timestamp + 120));
        uint256 beforeEth = ALICE.balance;
        (bool ok, bytes memory reason) = ROUTER.call(data);
        if (!ok) assembly ("memory-safe") { revert(add(reason,32),mload(reason)) }
        outAmount = ALICE.balance - beforeEth;
        vm.stopPrank();
    }

    function testRouteInitialBuyAndSellIgnoreExistingRouterAssets() public {
        seedExternal();
        uint256 snapshot = vm.snapshotState();
        Host.Launch memory first = launchNative(91);
        uint256 ordinaryBuy = IERC20(first.token).balanceOf(ALICE);
        uint256 platformBuy = AnyQuoteLedgerV1(address(host.ledger())).claimableQuote(QUOTE, A.PLATFORM_RECIPIENT);
        uint256 ordinarySell = sell(first.token, ordinaryBuy / 3, 1);
        uint256 platformBoth = AnyQuoteLedgerV1(address(host.ledger())).claimableQuote(QUOTE, A.PLATFORM_RECIPIENT);
        assertGt(ordinaryBuy, 0); assertGt(ordinarySell, 0); assertGt(platformBoth, platformBuy); assertGt(platformBuy, 0);
        assertTrue(vm.revertToState(snapshot));
        quote.mint(ROUTER, 11 ether); vm.deal(ROUTER, 7 ether);
        Host.Launch memory donated = launchNative(91);
        assertEq(donated.token, first.token);
        assertEq(IERC20(donated.token).balanceOf(ALICE), ordinaryBuy);
        assertEq(quote.balanceOf(ALICE), 0, "initial buy requires no quote holdings");
        vm.prank(ALICE); IERC20(donated.token).transfer(ROUTER, 17);
        assertEq(sell(donated.token, ordinaryBuy / 3, 1), ordinarySell);
        assertEq(AnyQuoteLedgerV1(address(host.ledger())).claimableQuote(QUOTE, A.PLATFORM_RECIPIENT), platformBoth);
        assertEq(quote.balanceOf(ROUTER), 11 ether); assertEq(ROUTER.balance, 7 ether);
        assertEq(IERC20(donated.token).balanceOf(ROUTER), 17);
        assertEq(IERC20(donated.token).totalSupply(), A.TOKEN_SUPPLY);
        assertEq(quote.balanceOf(address(host)), 0); assertEq(address(host).balance, 0);
    }

    function containsSelector(bytes memory reason, bytes4 selector) internal pure returns(bool) {
        for (uint256 i; i + 4 <= reason.length; ++i) {
            bytes4 got; assembly ("memory-safe") { got := mload(add(add(reason,32),i)) }
            if (got == selector) return true;
        }
        return false;
    }

    function testRouteExternalPartialFillRollsBackLaunchAndDoesNotUseDonations() public {
        seedExternal(); quote.mint(ROUTER, 11 ether); vm.deal(ROUTER, 7 ether); vm.deal(ALICE, 2000000 ether);
        Host.LaunchParameters memory p = nativeParams(92, 1000000 ether, 1);
        (address predicted,) = host.predictTokenAddress(p.name, p.symbol, ALICE, p.creatorSalt);
        uint256 quoteBefore = quote.balanceOf(MANAGER); uint256 nativeBefore = MANAGER.balance; uint256 aliceBefore = ALICE.balance;
        vm.prank(ALICE); (bool ok, bytes memory reason) = address(host).call{value: 1000000 ether}(abi.encodeCall(Host.launch, (p)));
        assertFalse(ok); assertTrue(containsSelector(reason, bytes4(keccak256("CurrencyNotSettled()"))), "external partial fill must leave an unsettled delta");
        assertEq(predicted.code.length, 0); assertEq(quote.balanceOf(MANAGER), quoteBefore); assertEq(MANAGER.balance, nativeBefore);
        assertEq(ALICE.balance, aliceBefore); assertEq(ROUTER.balance, 7 ether); assertEq(quote.balanceOf(ROUTER), 11 ether);
    }

    function testRouteFinalMinimumIsIndependentOfRouterDonation() public {
        seedExternal(); Host.Launch memory launched = launchNative(93);
        uint256 amount = IERC20(launched.token).balanceOf(ALICE) / 3;
        vm.deal(ROUTER, 100 ether); quote.mint(ROUTER, 100 ether);
        bytes memory data = encoded(launched.token, false, amount, 10 ether, false);
        vm.startPrank(ALICE);
        if (IERC20(launched.token).allowance(ALICE, PERMIT2) < amount) IERC20(launched.token).approve(PERMIT2, amount);
        IRoutePermit2(PERMIT2).approve(launched.token, ROUTER, uint160(amount), uint48(block.timestamp + 120));
        uint256 tokens = IERC20(launched.token).balanceOf(ALICE); uint256 ethBefore = ALICE.balance;
        (bool ok,) = ROUTER.call(data); assertFalse(ok);
        assertEq(IERC20(launched.token).balanceOf(ALICE), tokens); assertEq(ALICE.balance, ethBefore);
        assertEq(ROUTER.balance, 100 ether); assertEq(quote.balanceOf(ROUTER), 100 ether);
        vm.stopPrank();
    }
}
`;
    writeFileSync(resolve(work, "RouteRuntime.t.sol"), source);
    const foundryConfig = readFileSync(resolve(contracts, "foundry.toml"), "utf8")
      .replace('libs = ["lib"]', `libs = ["${contracts}/lib"]`)
      .replace(/fs_permissions = \[[\s\S]*?\n\]/, `fs_permissions = [{ access = "read", path = "${out}" }]`);
    writeFileSync(resolve(work, "foundry.toml"), foundryConfig);
    const remappings = readFileSync(resolve(contracts, "remappings.txt"), "utf8").trim().split("\n").map(line => { const [from, to] = line.split("="); return `${from}=${resolve(contracts, to)}/`; });
    remappings.push(`src/=${contracts}/src/`, `test/module-engine/=${contracts}/test/module-engine/`);
    writeFileSync(resolve(work, "remappings.txt"), remappings.join("\n") + "\n");
    const result = spawnSync("forge", ["test", "--root", work, "--match-contract", "AnyQuoteRouteRuntimeTest", "--match-test", "testRoute", "--ffi", "-vv"], {
      cwd: contracts, encoding: "utf8", timeout: 160_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, FOUNDRY_SRC: resolve(contracts, "src/module-engine/any-quote"), FOUNDRY_TEST: work, FOUNDRY_SCRIPT: work, FOUNDRY_OUT: out, FOUNDRY_CACHE_PATH: resolve(work, "cache") },
    });
    writeFileSync(resolve(work, "verification.txt"), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    assert.equal(result.status, 0, `${result.error?.message ?? ""}\n${result.stdout?.slice(-12000)}\n${result.stderr?.slice(-2000)}`);
    console.log(result.stdout);
  });
}
