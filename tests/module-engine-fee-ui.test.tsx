import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModuleEngineFeeChangeReceipt } from "@/components/module-engine-fee-controls";
import { ModuleEngineTransactionReview } from "@/components/module-engine-transaction-review";
import { noteModuleEngineSubmission, observeModuleEngineReceipt, prepareModuleEngineFeeChange, revalidateModuleEngineTransaction } from "@/lib/module-engine/client";
import { feeFixture, NEW_WALLET } from "./module-engine-fee-fixture";

describe("fee recipient review", () => {
  it("shows old/new creator wallets, fixed shares and actual admin authority before wallet confirmation", async () => {
    const f = feeFixture(), prepared = await prepareModuleEngineFeeChange({ ...f.input, account: f.fees.treasury, intent: { kind: "replace-creators", recipients: [NEW_WALLET, f.fees.creatorWallets[1]] } });
    const confirm = vi.fn(), html = renderToStaticMarkup(<ModuleEngineTransactionReview prepared={prepared} busy={false} onConfirm={confirm} onEdit={vi.fn()} />);
    for (const text of ["Review creator fee recipients", "Ledger treasury", "60%", "Current:", "New:", NEW_WALLET, f.fees.creatorWallets[0], "Existing", "administrative revision"]) expect(html).toContain(text === "Existing" ? "existing claims" : text);
    expect(html).toContain("does not advance that revision"); expect(confirm).not.toHaveBeenCalled();
  });
  it("makes author scope and the onchain race boundary explicit", async () => {
    const f = feeFixture(), prepared = await prepareModuleEngineFeeChange({ ...f.input, intent: { kind: "rotate-author", familyId: f.template.manifest.manifest.revision.familyId, recipient: NEW_WALLET } });
    const html = renderToStaticMarkup(<ModuleEngineTransactionReview prepared={prepared} busy={false} onConfirm={vi.fn()} onEdit={vi.fn()} />);
    for (const text of ["Registered author", "whole family across all coins", "authorship stay unchanged", f.fees.authorWallet, NEW_WALLET, "no onchain deadline or expected previous wallet", "Another permitted change may be mined"]) expect(html).toContain(text);
  });
  it("shows actual confirmed targets and a superseding change without inviting another send", async () => {
    const f = feeFixture(), prepared = await prepareModuleEngineFeeChange({ ...f.input, intent: { kind: "rotate-author", familyId: f.template.manifest.manifest.revision.familyId, recipient: NEW_WALLET } });
    await revalidateModuleEngineTransaction(prepared, prepared.account); f.fees.authorWallet = f.fees.treasury;
    const receipt = f.mined(prepared); noteModuleEngineSubmission(prepared, receipt.transactionHash); f.fees.authorWallet = f.fees.administrator;
    const result = await observeModuleEngineReceipt(prepared, receipt.transactionHash), html = renderToStaticMarkup(<ModuleEngineFeeChangeReceipt result={result} />);
    expect(html).toContain(f.fees.treasury); expect(html).toContain(NEW_WALLET); expect(html).toContain("after your preview"); expect(html).toContain("later change"); expect(html).toContain("Finality is still pending"); expect(html).not.toContain("<button");
  });
});
