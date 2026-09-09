import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileModuleSubmissions, type ProfileModuleSubmission } from "@/components/profile-module-submissions";

const item: ProfileModuleSubmission = {
  id: "d260e6b8-d986-4e02-a63b-d420406e37c8", packageId: `0x${"a".repeat(64)}`, author: `0x${"b".repeat(40)}`,
  title: "Opening rules", version: "1.0.0", reviewState: "changes_requested",
  submittedAt: "2026-09-08T20:00:00.000Z", updatedAt: "2026-09-09T10:00:00.000Z",
  feedback: "Prove that fees can be withdrawn after the opening window.",
};

describe("profile submission presentation", () => {
  it("offers separate named details and copy actions without requiring a disclosure to find the handoff", () => {
    const html = renderToStaticMarkup(<ProfileModuleSubmissions data={{ status: "ready", items: [item] }} />);
    expect(html).toContain('aria-label="Your submitted modules"');
    expect(html).toContain('aria-label="Copy for agent: Opening rules, version 1.0.0"');
    expect(html).toContain('aria-label="View details for Opening rules, version 1.0.0, Changes requested"');
    expect(html).toContain('aria-expanded="false"');
    const controls = /aria-controls="([^"]+)"/u.exec(html)?.[1];
    expect(controls).toBeTruthy();
    expect(html).toContain(`id="${controls}" hidden=""`);
    expect(html.match(/<button /gu)).toHaveLength(2);
    expect(html).toContain('role="status" aria-atomic="true"');
    expect(html).toContain("Review feedback");
    expect(html).toContain(item.id);
    expect(html).not.toContain(item.packageId);
    expect(html).not.toContain(item.author);
  });

  it("never presents a missing review as submitted or a successful build as a public module", () => {
    const unknown = renderToStaticMarkup(<ProfileModuleSubmissions data={{ status: "ready", items: [{ ...item, reviewState: null, submittedAt: undefined, feedback: undefined }] }} />);
    expect(unknown).toContain("Status unavailable");
    expect(unknown).not.toContain("Waiting for a review plan");
    const accepted = renderToStaticMarkup(<ProfileModuleSubmissions data={{ status: "ready", items: [{ ...item, reviewState: "accepted", feedback: "Compatibility review complete." }] }} />);
    expect(accepted).toContain("Review approved");
    expect(accepted).toContain("Publication is a separate step");
    expect(accepted).not.toContain(">Published<");
    const built = renderToStaticMarkup(<ProfileModuleSubmissions data={{ status: "ready", items: [{ ...item, reviewState: "built" }] }} />);
    expect(built).toContain("Ready for review");
    expect(built).not.toContain("Review approved");
  });

  it("renders titles and reviewer feedback as text rather than executable markup", () => {
    const html = renderToStaticMarkup(<ProfileModuleSubmissions data={{ status: "ready", items: [{ ...item,
      title: "A <script> module", feedback: '<img src=x onerror="steal()">\n[Unexpected link](https://example.invalid)' }] }} />);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/<script>|<img|href="https:\/\/example.invalid/);
    expect(html).not.toContain("steal()\">" );
  });

  it("keeps empty, loading and unavailable feeds distinct with an actionable retry", () => {
    const empty = renderToStaticMarkup(<ProfileModuleSubmissions data={{ status: "ready", items: [] }} />);
    expect(empty).toContain("No submissions yet.");
    expect(empty).toContain('href="/developers/modules"');
    const loading = renderToStaticMarkup(<ProfileModuleSubmissions data={{ status: "loading" }} />);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain("No submissions yet.");
    const failed = renderToStaticMarkup(<ProfileModuleSubmissions data={{ status: "error" }} onRetry={() => {}} />);
    expect(failed).toContain("Try again");
    expect(failed).not.toContain("No submissions yet.");
    expect(renderToStaticMarkup(<ProfileModuleSubmissions />)).not.toContain("isn’t available here yet");
  });
});
