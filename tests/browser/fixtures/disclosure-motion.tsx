/** Local motion and focus fixture. No provider, wallet, API key, or network writes. */
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Disclosure, DisclosurePanel, useDisclosureState } from "../../../components/disclosure";
import { ModulePickerDialog } from "../../../components/module-picker-dialog";

function Fixture() {
  const details = useRef<HTMLDetailsElement>(null);
  const panel = useDisclosureState();
  const [dialog, setDialog] = useState<{ pointer: boolean } | null>(null);
  return <main>
    <h1>Disclosure interaction fixture</h1>
    <form onSubmit={event => event.preventDefault()}>
      <Disclosure ref={details} id="native" className="example">
        <summary>Description and links</summary>
        <div className="body"><label>Description<textarea /></label>
          <Disclosure id="nested"><summary>More links</summary><div className="body"><label>Website<input type="url" defaultValue="invalid" /></label></div></Disclosure>
        </div>
      </Disclosure>
      <button type="button" onClick={() => { if (details.current) details.current.open = true; }}>Reveal details</button>
      <button type="button" onClick={() => details.current?.querySelector("input")?.reportValidity()}>Check website</button>
      <button type="button" aria-expanded={panel.expanded} aria-controls="controlled" onClick={panel.toggle}>Creator fees</button>
      <DisclosurePanel id="controlled" {...panel.panelProps} className="body"><label>Buy fee<select><option>0%</option><option>1%</option></select></label></DisclosurePanel>
      <button type="button" onClick={event => setDialog({ pointer: event.detail > 0 })}>Add modules</button>
    </form>
    {dialog ? <ModulePickerDialog title="Modules" animateOpen={dialog.pointer} onClose={() => setDialog(null)}>
      <Disclosure><summary>About modules</summary><div className="body"><a href="#module">Read module details</a></div></Disclosure>
      <button type="button">Choose module</button>
    </ModulePickerDialog> : null}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
