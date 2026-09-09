import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileModules } from "@/components/profile-modules";

const privateFeed = vi.hoisted(() => ({ initialized: vi.fn() }));
vi.mock("@/components/profile-module-submissions-feed", () => {
  privateFeed.initialized();
  return { ProfileModuleSubmissionsFeed: () => <p>Private submission fixture</p> };
});

const account = `0x${"a".repeat(40)}`;

describe("public module profile boundary", () => {
  beforeEach(() => { expect(privateFeed.initialized).not.toHaveBeenCalled(); });

  it("renders public publications without initializing the private wallet feed", () => {
    const html = renderToStaticMarkup(<ProfileModules account={account} />);
    expect(html).toContain("Loading modules");
    expect(html).not.toContain("Private submission fixture");
    expect(privateFeed.initialized).not.toHaveBeenCalled();
  });

  it("does not load private data for a public profile even if a submissions section was requested", () => {
    const html = renderToStaticMarkup(<ProfileModules account={account} initialSection="submissions" />);
    expect(html).toContain("Loading modules");
    expect(html).not.toContain("Loading submissions");
    expect(privateFeed.initialized).not.toHaveBeenCalled();
  });

  it("keeps an owner's published tab independent of private submission code", () => {
    const html = renderToStaticMarkup(<ProfileModules account={account} ownProfile />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Loading modules");
    expect(privateFeed.initialized).not.toHaveBeenCalled();
  });
});
