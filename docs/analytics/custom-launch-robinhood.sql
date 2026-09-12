-- Robinhood Custom analytics: Native20 and the verified BLOB fee-vault adapter.
-- All amounts use one common Dune-indexed, chain-finalized checkpoint.
-- Revenue is earned fees. Claims, LP fees, gas and transfers are not added to revenue.
-- Volume is actual PoolManager native-side execution volume, counted once per Swap.
-- Includes reference launches. Other fee mechanisms require a verified adapter.
WITH rpc AS (
    SELECT CAST(json_parse(http_post(
        'https://rpc.mainnet.chain.robinhood.com',
        '[{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]},{"jsonrpc":"2.0","id":2,"method":"eth_getBlockByNumber","params":["finalized",false]}]',
        ARRAY['Content-Type: application/json']
    )) AS ARRAY(JSON)) AS replies
), chain_head AS (
    SELECT CASE
        WHEN json_extract_scalar(element_at(filter(replies, r -> json_extract_scalar(r, '$.id') = '1'), 1), '$.result') = '0x1237'
        THEN from_base(substr(json_extract_scalar(element_at(filter(replies, r -> json_extract_scalar(r, '$.id') = '2'), 1), '$.result.number'), 3), 16)
        ELSE CAST('WRONG_CHAIN_OR_RPC_UNAVAILABLE' AS BIGINT)
    END AS chain_finalized_block
    FROM rpc
), checkpoint AS (
    SELECT coalesce(max(b.number), CAST('FINALIZED_DUNE_CHECKPOINT_UNAVAILABLE' AS BIGINT)) AS finalized_block,
           max(b.time) AS finalized_at, max(h.chain_finalized_block) AS chain_finalized_block
    FROM robinhood.blocks b CROSS JOIN chain_head h
    WHERE b.time >= current_timestamp - INTERVAL '1' DAY
      AND b.number <= h.chain_finalized_block
), launches AS (
    SELECT l.contract_address AS router, l.topic1 AS launch_id,
           varbinary_substring(l.topic2, 13, 20) AS token,
           varbinary_substring(l.topic3, 13, 20) AS hook,
           varbinary_substring(l.data, 33, 32) AS pool_id,
           min(l.block_number) AS launch_block
    FROM robinhood.logs l CROSS JOIN checkpoint c
    WHERE l.block_time >= TIMESTAMP '2026-08-31 00:00:00'
      AND l.block_number >= 50469365 AND l.block_number <= c.finalized_block
      AND varbinary_length(l.data) = 96
      AND varbinary_substring(l.data, 13, 20) = 0x8366a39cc670b4001a1121b8f6a443a643e40951
      AND ((l.contract_address = 0x34965f2a2ee9254522232c32f02056e92be0c98a
            AND l.topic0 = 0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2)
        OR (l.contract_address IN (0x9fd629cd1eb47fb20813c2403153714b523f681e,
                                   0x4b5cec6e715c3bcd7e6837e9e307c40c9acc2b2e)
            AND l.topic0 = 0x4916167b998f441a46d1e4bc734a855746d34935136a4b3bc2575f7cf5682e1e))
    GROUP BY 1, 2, 3, 4, 5
), native20_fees AS (
    SELECT l.contract_address AS hook, l.topic1 AS pool_id, l.tx_hash, l."index" AS log_index,
           varbinary_to_uint256(varbinary_substring(l.data, 33, 32)) AS gross_native_wei,
           varbinary_to_uint256(varbinary_substring(l.data, 65, 32)) AS protocol_wei,
           varbinary_to_uint256(varbinary_substring(l.data, 97, 32)) AS creator_wei
    FROM robinhood.logs l CROSS JOIN checkpoint c
    WHERE l.block_time >= TIMESTAMP '2026-08-31 00:00:00'
      AND l.block_number >= 50469365 AND l.block_number <= c.finalized_block
      AND l.topic0 = 0xd4d0f5055e2337ff5463933dff69d06a57f6cc89503aed6e89d23c1bda23c94c
      AND varbinary_length(l.data) = 128
      AND l.contract_address <> 0x105f6435a4ab3c03c13d4a0db67961344694d0cc
      AND EXISTS (SELECT 1 FROM launches s
                  WHERE l.contract_address = s.hook AND l.topic1 = s.pool_id AND l.block_number >= s.launch_block)
), blob_adapter AS (
    -- Exact finalized deployment and source-verified immutable fee-vault wiring, 2026-09-10.
    -- This exception is a separate accounting adapter, not an assumption about arbitrary custom hooks.
    SELECT 0xc4b0ae2d8530ddd043c8124bf79297a17166baf7 AS vault, launch_block
    FROM launches
    WHERE router = 0x4b5cec6e715c3bcd7e6837e9e307c40c9acc2b2e
      AND token = 0x105f6435a4ab3c03c13d4a0db67961344694d0cc
      AND hook = token
      AND pool_id = 0xd4ec7c72641720f85b309c9ff9f3c61a3cd4c85fcef2bd416d35ebb00696847b
), blob_fees AS (
    SELECT varbinary_to_uint256(varbinary_substring(l.data, 1, 32)) AS protocol_wei,
           varbinary_to_uint256(varbinary_substring(l.data, 33, 32)) AS creator_wei
    FROM robinhood.logs l CROSS JOIN checkpoint c
    WHERE l.block_time >= TIMESTAMP '2026-09-10 00:00:00'
      AND l.block_number <= c.finalized_block
      AND l.contract_address = 0xc4b0ae2d8530ddd043c8124bf79297a17166baf7
      AND l.topic0 = 0x89aac707e63949a6b4f34ddf7059a674a7023add93e77158c2986b78edac6076
      AND varbinary_length(l.data) = 64
      AND EXISTS (SELECT 1 FROM blob_adapter a WHERE l.contract_address = a.vault AND l.block_number >= a.launch_block)
), fees AS (
    SELECT protocol_wei, creator_wei FROM native20_fees
    UNION ALL
    SELECT protocol_wei, creator_wei FROM blob_fees
), native_pools AS (
    SELECT DISTINCT s.pool_id, s.launch_block
    FROM launches s
    WHERE EXISTS (
        SELECT 1 FROM robinhood.logs i CROSS JOIN checkpoint c
        WHERE i.block_time >= TIMESTAMP '2026-08-31 00:00:00'
          AND i.block_number <= c.finalized_block
          AND i.contract_address = 0x8366a39cc670b4001a1121b8f6a443a643e40951
          AND i.topic0 = 0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438
          AND i.topic1 = s.pool_id
          AND i.topic2 = 0x0000000000000000000000000000000000000000000000000000000000000000
    )
), pool_swaps AS (
    SELECT l.tx_hash, l."index" AS log_index, l.topic1 AS pool_id,
           CAST(abs(varbinary_to_int256(varbinary_substring(l.data, 1, 32))) AS UINT256) AS volume_wei
    FROM robinhood.logs l CROSS JOIN checkpoint c
    WHERE l.block_time >= TIMESTAMP '2026-08-31 00:00:00'
      AND l.block_number >= 50469365 AND l.block_number <= c.finalized_block
      AND l.contract_address = 0x8366a39cc670b4001a1121b8f6a443a643e40951
      AND l.topic0 = 0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f
      AND varbinary_length(l.data) = 192
      AND EXISTS (SELECT 1 FROM native_pools p WHERE l.topic1 = p.pool_id AND l.block_number >= p.launch_block)
), fee_totals AS (
    SELECT coalesce(sum(protocol_wei), UINT256 '0') AS protocol_wei,
           coalesce(sum(creator_wei), UINT256 '0') AS creator_rewards_wei
    FROM fees
), swap_totals AS (
    SELECT count(*) AS swaps, coalesce(sum(volume_wei), UINT256 '0') AS volume_wei FROM pool_swaps
)
SELECT (SELECT count(*) FROM launches) AS custom_launches,
       CAST(f.creator_rewards_wei AS DOUBLE) / 1e18 AS creator_rewards_eth,
       CAST(f.protocol_wei AS DOUBLE) / 1e18 AS protocol_revenue_eth,
       CAST(f.creator_rewards_wei + f.protocol_wei AS DOUBLE) / 1e18 AS total_fees_eth,
       CAST(s.volume_wei AS DOUBLE) / 1e18 AS volume_eth,
       s.swaps, s.volume_wei, f.creator_rewards_wei, f.protocol_wei,
       c.finalized_block, c.finalized_at,
       (SELECT coalesce(sum(protocol_wei), UINT256 '0') FROM native20_fees
        WHERE hook = 0x94f6cef92a5363860de99836c968382f4410a0cc) AS arbt_protocol_wei,
       (SELECT coalesce(sum(protocol_wei), UINT256 '0') FROM blob_fees) AS blob_protocol_wei,
       (SELECT coalesce(sum(gross_native_wei), UINT256 '0') FROM native20_fees) AS native20_gross_volume_wei,
       (SELECT count(*) FROM launches l WHERE NOT EXISTS (
           SELECT 1 FROM native20_fees n WHERE n.hook = l.hook AND n.pool_id = l.pool_id
       ) AND NOT EXISTS (SELECT 1 FROM blob_adapter b WHERE b.launch_block = l.launch_block
           AND l.token = 0x105f6435a4ab3c03c13d4a0db67961344694d0cc)) AS launches_without_observed_supported_fees,
       c.chain_finalized_block
FROM fee_totals f CROSS JOIN swap_totals s CROSS JOIN checkpoint c
