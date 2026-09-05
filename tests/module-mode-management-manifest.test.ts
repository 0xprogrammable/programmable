import { describe, expect, it } from "vitest";
import { bindModuleManagementManifest, managementReadAbi, referenceManagementManifest, unsupportedManagementCapabilities } from "@/lib/module-mode/management-manifest";

describe("declarative management boundary", () => {
  it("binds both initial programs without business-name dispatch in the runtime interpreter", () => {
    const reward = bindModuleManagementManifest(referenceManagementManifest("reward"));
    const cap = bindModuleManagementManifest(referenceManagementManifest("cap"));
    expect(reward.actions[0]).toMatchObject({ encoding: "empty", role: { kind: "read-wallet", readId: "refund-wallet" }, availableAfterRead: "ends-at" });
    expect(reward.budget.fundable).toBe(true);
    expect(cap.budget.fundable).toBe(false);
    expect(cap.actions).toEqual([]);
    expect(cap.reads.find(read => read.id === "spent")?.args).toEqual([{ binding: "actor" }]);
  });
  it("cannot introduce a write ABI, arbitrary target, account binding or unbound role", () => {
    const original = referenceManagementManifest("reward");
    for (const change of [
      { target: "0x1111111111111111111111111111111111111111" },
      { signature: "function changeOwner() returns (uint256)" },
      { signature: "function currentOwner(address who) view returns (address)", args: [{ binding: "callerSuppliedAddress" }] },
    ]) {
      expect(() => bindModuleManagementManifest({ ...original, reads: [{ ...original.reads[0], ...change }, ...original.reads.slice(1)] })).toThrow();
    }
    expect(() => bindModuleManagementManifest({ ...original, actions: [{ ...original.actions[0], role: { kind: "read-wallet", readId: "every-n" } }] })).toThrow();
    expect(() => bindModuleManagementManifest({ ...original, actions: [{ ...original.actions[0], availableAfterRead: "refund-wallet" }] })).toThrow();
    expect(() => managementReadAbi({ signature: "function read() view returns (uint256[])", args: [] })).toThrow();
  });
  it("retains unknown capabilities for an explicit unavailable state and rejects unknown format", () => {
    const original = referenceManagementManifest("reward");
    const future = bindModuleManagementManifest({ ...original, capabilities: [...original.capabilities, "new-state-renderer@2"] });
    expect(unsupportedManagementCapabilities(future)).toEqual(["new-state-renderer@2"]);
    expect(() => bindModuleManagementManifest({ ...original, format: "programmable.module-management.v99" })).toThrow();
  });
  it("supports new schema-driven actions but rejects hidden inputs, duplicate IDs and undeclared capabilities", () => {
    const original = referenceManagementManifest("reward");
    const action = { ...original.actions[0], encoding: "open-config", inputSchema: { type: "record", fields: { amount: { type: "uint", bits: 128, min: "1" } }, required: ["amount"] } };
    expect(bindModuleManagementManifest({ ...original, capabilities: [...original.capabilities, "open-config-inputs@1"], actions: [action] }).actions[0].encoding).toBe("open-config");
    expect(() => bindModuleManagementManifest({ ...original, actions: [action] })).toThrow();
    expect(() => bindModuleManagementManifest({ ...original, actions: [{ ...action, encoding: "empty" }] })).toThrow();
    expect(() => bindModuleManagementManifest({ ...original, actions: [...original.actions, ...original.actions] })).toThrow();
    let invoked = false;
    expect(() => bindModuleManagementManifest({ ...original, get reads() { invoked = true; return []; } })).toThrow();
    expect(invoked).toBe(false);
  });
});
