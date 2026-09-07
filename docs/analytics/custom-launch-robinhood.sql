-- Custom Launch on Robinhood Chain, source version custom-native20-v1.
-- Counts canonical V1 and V2 Launch Stamp Router events, including reference launches.
-- ETH earnings use NativeFeesAccrued from the stamped hook and its exact pool.
-- These are credited fees, including unclaimed balances, not treasury withdrawals.
-- Creator fees and the 20 bps Programmable allocation remain separate.
-- Gas, liquidity, donations, LP fees and fee claims are not new fee revenue.
-- Historical Custom fee models without this event are outside the ETH fee totals.
-- Dune history and the recent RPC overlap are deduplicated at a finalized cutoff.
WITH dune_head AS (
    SELECT greatest(BIGINT '50469365', coalesce(max(number) - 20000, BIGINT '50469365')) AS rpc_from
    FROM robinhood.blocks
    WHERE time >= current_timestamp - INTERVAL '2' DAY
), batch AS (
    SELECT documents
    FROM dune_head
    CROSS JOIN UNNEST(ARRAY[CAST(json_parse(http_post(
        'https://rpc.mainnet.chain.robinhood.com',
        concat('[{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]},',
               '{"jsonrpc":"2.0","id":2,"method":"eth_getBlockByNumber","params":["finalized",false]},',
               '{"jsonrpc":"2.0","id":3,"method":"eth_getLogs","params":[{"fromBlock":"0x',
               to_base(rpc_from, 16), '","toBlock":"finalized",',
               '"topics":[["0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2","0x4916167b998f441a46d1e4bc734a855746d34935136a4b3bc2575f7cf5682e1e","0xd4d0f5055e2337ff5463933dff69d06a57f6cc89503aed6e89d23c1bda23c94c"]]}]}]'),
        ARRAY['Content-Type: application/json']
    )) AS ARRAY(JSON))]) AS r(documents)
), replies AS (
    SELECT
        element_at(filter(documents, d -> json_extract_scalar(d, '$.id') = '1'), 1) AS chain_reply,
        element_at(filter(documents, d -> json_extract_scalar(d, '$.id') = '2'), 1) AS head_reply,
        element_at(filter(documents, d -> json_extract_scalar(d, '$.id') = '3'), 1) AS logs_reply
    FROM batch
), rpc_response AS (
    SELECT
        CASE WHEN json_extract_scalar(chain_reply, '$.result') = '0x1237'
                  AND json_extract_scalar(head_reply, '$.result.number') IS NOT NULL
             THEN from_base(substr(json_extract_scalar(head_reply, '$.result.number'), 3), 16)
             ELSE CAST('FINALIZED_ROBINHOOD_HEAD_UNAVAILABLE' AS BIGINT) END AS final_block,
        from_base(substr(json_extract_scalar(head_reply, '$.result.timestamp'), 3), 16) AS final_timestamp,
        CAST(json_parse(CASE WHEN substr(json_format(json_extract(logs_reply, '$.result')), 1, 1) = '['
                            THEN json_format(json_extract(logs_reply, '$.result'))
                            ELSE 'RPC_LOGS_UNAVAILABLE' END) AS ARRAY(JSON)) AS records
    FROM replies
), rpc_logs AS (
    SELECT
        from_base(substr(json_extract_scalar(document, '$.blockNumber'), 3), 16) AS block_number,
        from_hex(substr(json_extract_scalar(document, '$.blockHash'), 3)) AS block_hash,
        from_hex(substr(json_extract_scalar(document, '$.transactionHash'), 3)) AS tx_hash,
        from_base(substr(json_extract_scalar(document, '$.logIndex'), 3), 16) AS log_index,
        from_hex(substr(json_extract_scalar(document, '$.address'), 3)) AS contract_address,
        from_hex(substr(json_extract_scalar(document, '$.topics[0]'), 3)) AS topic0,
        from_hex(substr(json_extract_scalar(document, '$.topics[1]'), 3)) AS topic1,
        from_hex(substr(json_extract_scalar(document, '$.topics[2]'), 3)) AS topic2,
        from_hex(substr(json_extract_scalar(document, '$.topics[3]'), 3)) AS topic3,
        from_hex(substr(json_extract_scalar(document, '$.data'), 3)) AS data,
        final_block, final_timestamp
    FROM rpc_response
    CROSS JOIN UNNEST(concat(records, ARRAY[CAST(NULL AS JSON)])) AS r(document)
    WHERE coalesce(json_extract_scalar(document, '$.removed'), 'false') = 'false'
), stored_logs AS (
    SELECT block_number, block_hash, tx_hash, "index" AS log_index,
           contract_address, topic0, topic1, topic2, topic3, data,
           CAST(NULL AS BIGINT) AS final_block, CAST(NULL AS BIGINT) AS final_timestamp
    FROM robinhood.logs
    WHERE block_time >= TIMESTAMP '2026-08-31 00:00:00'
      AND block_number >= 50469365
      AND topic0 IN (
          0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2,
          0x4916167b998f441a46d1e4bc734a855746d34935136a4b3bc2575f7cf5682e1e,
          0xd4d0f5055e2337ff5463933dff69d06a57f6cc89503aed6e89d23c1bda23c94c
      )
), combined AS (
    SELECT * FROM stored_logs UNION ALL SELECT * FROM rpc_logs
), ranked AS (
    SELECT *, max(final_block) OVER () AS finalized_block,
           max(final_timestamp) OVER () AS finalized_timestamp,
           row_number() OVER (PARTITION BY block_hash, tx_hash, log_index ORDER BY block_number) AS duplicate_rank
    FROM combined
), logs AS (
    SELECT * FROM ranked
    WHERE duplicate_rank = 1 AND (block_number <= finalized_block OR block_number IS NULL)
), launches AS (
    SELECT contract_address AS router, topic1 AS launch_id,
           varbinary_substring(topic2, 13, 20) AS token,
           varbinary_substring(topic3, 13, 20) AS hook,
           varbinary_substring(data, 33, 32) AS pool_id,
           block_number AS launch_block
    FROM logs
    WHERE varbinary_substring(data, 13, 20) = 0x8366a39cc670b4001a1121b8f6a443a643e40951
      AND ((contract_address = 0x34965f2a2ee9254522232c32f02056e92be0c98a
            AND topic0 = 0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2)
        OR (contract_address = 0x9fd629cd1eb47fb20813c2403153714b523f681e
            AND topic0 = 0x4916167b998f441a46d1e4bc734a855746d34935136a4b3bc2575f7cf5682e1e))
), trades AS (
    SELECT l.* FROM logs l
    WHERE l.topic0 = 0xd4d0f5055e2337ff5463933dff69d06a57f6cc89503aed6e89d23c1bda23c94c
      AND EXISTS (
          SELECT 1 FROM launches s
          WHERE l.contract_address = s.hook AND l.topic1 = s.pool_id
            AND l.block_number >= s.launch_block
      )
), totals AS (
    SELECT count(*) AS swaps,
           coalesce(sum(varbinary_to_uint256(varbinary_substring(data, 33, 32))), UINT256 '0') AS volume_wei,
           coalesce(sum(varbinary_to_uint256(varbinary_substring(data, 65, 32))), UINT256 '0') AS protocol_wei,
           coalesce(sum(varbinary_to_uint256(varbinary_substring(data, 97, 32))), UINT256 '0') AS creator_rewards_wei
    FROM trades
)
SELECT (SELECT count(*) FROM launches) AS custom_launches,
       CAST(creator_rewards_wei AS DOUBLE) / 1e18 AS creator_rewards_eth,
       CAST(protocol_wei AS DOUBLE) / 1e18 AS protocol_revenue_eth,
       CAST(creator_rewards_wei + protocol_wei AS DOUBLE) / 1e18 AS total_fees_eth,
       CAST(volume_wei AS DOUBLE) / 1e18 AS volume_eth,
       swaps, volume_wei, creator_rewards_wei, protocol_wei,
       (SELECT max(finalized_block) FROM logs) AS finalized_block,
       from_unixtime((SELECT max(finalized_timestamp) FROM logs)) AS finalized_at
FROM totals
