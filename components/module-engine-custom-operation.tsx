"use client";

import type { ModuleEnginePermission } from "@/lib/module-engine/catalog";
import { moduleEngineAssetOptions, type ModuleEngineAssetRole, type ModuleEngineCustomOperationForm } from "@/lib/module-engine/custom-operation";
import styles from "./module-mode-builder.module.css";
import engineStyles from "./module-engine-ui.module.css";

/** The host envelope is explicit; only the template author can describe the opaque action data. */
export function ModuleEngineCustomOperationFields({ id, permission, value, account, onChange }: {
  id: string; permission: ModuleEnginePermission; value: ModuleEngineCustomOperationForm; account?: string;
  onChange: (value: ModuleEngineCustomOperationForm) => void;
}) {
  return <div className={engineStyles.stack}>
    <p className={styles.help} id={`${id}-help`}>Use the action data specified by the template author. The review shows the assets, amounts and recipient you authorize. The website does not interpret what the data instructs the engine to do.</p>
    <dl className={styles.reviewRows}><div><dt>Reviewed operation ID</dt><dd>{permission.operationId}</dd></div><div><dt>Who can use it</dt><dd>{permission.authorization === 1 ? "Launch creator" : "Any wallet"}</dd></div></dl>
    {(["input", "output"] as const).map(side => {
      const input = side === "input", role = input ? value.inputRole : value.outputRole;
      return <div className={`${styles.twoFields} ${engineStyles.customAssetFields}`} key={side}>
        <div className={styles.field}><label htmlFor={`${id}-${side}-asset`}>{input ? "Asset to send" : "Asset to receive"}</label><select id={`${id}-${side}-asset`} value={role} onChange={event => onChange({ ...value, ...(input ? { inputRole: event.target.value as ModuleEngineAssetRole, inputAmount: "0" } : { outputRole: event.target.value as ModuleEngineAssetRole, minimumOutput: "0" }) })}>{moduleEngineAssetOptions(input ? permission.inputRoles : permission.outputRoles).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
        <div className={styles.field}><label htmlFor={`${id}-${side}-amount`}>{input ? "Amount to send" : "Minimum to receive"}</label><input id={`${id}-${side}-amount`} inputMode="decimal" autoComplete="off" value={input ? value.inputAmount : value.minimumOutput} readOnly={role === "none"} onChange={event => onChange({ ...value, ...(input ? { inputAmount: event.target.value } : { minimumOutput: event.target.value }) })} required /><p className={styles.help}>{role === "none" ? "Zero with no asset selected." : role === "eth" ? "In ETH." : `In ${moduleEngineAssetOptions(7).find(option => option.id === role)?.label.toLowerCase()} units.`}</p></div>
      </div>;
    })}
    <div className={styles.field}><label htmlFor={`${id}-recipient`}>Recipient wallet</label><input id={`${id}-recipient`} autoComplete="off" spellCheck={false} value={value.recipient} placeholder={account} onChange={event => onChange({ ...value, recipient: event.target.value })} /><p className={styles.help}>Leave blank to use your connected wallet. The action data may impose additional recipient rules.</p></div>
    <div className={styles.field}><label htmlFor={`${id}-data`}>Action data</label><textarea id={`${id}-data`} autoComplete="off" autoCapitalize="none" spellCheck={false} value={value.data} maxLength={32_770} aria-describedby={`${id}-help ${id}-data-help`} onChange={event => onChange({ ...value, data: event.target.value })} required /><p className={styles.help} id={`${id}-data-help`}>Hex bytes starting with 0x. Use 0x for an action with no data. Maximum 16 KiB.</p></div>
  </div>;
}
