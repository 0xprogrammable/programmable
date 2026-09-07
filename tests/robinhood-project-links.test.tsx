import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RobinhoodProjectLinks } from "@/components/robinhood-project-links";
import { MODULE_TOKEN_FALLBACK_IMAGE, RobinhoodCoinArtwork } from "@/components/robinhood-coin-artwork";

describe("Coin metadata presentation", () => {
  it("renders every supported social as an individually named external link", () => {
    const links = ["Website", "X", "Telegram", "Discord", "GitHub", "GitBook"].map(label => ({ label, url: `https://example.com/${label.toLowerCase()}` }));
    const html = renderToStaticMarkup(<RobinhoodProjectLinks links={links} name="Coin" />);
    expect(html).toContain('aria-label="Coin links"');
    expect(html.match(/<a /g)).toHaveLength(6);
    for (const link of links) {
      expect(html).toContain(`aria-label="${link.label} (opens in a new tab)"`);
      expect(html).toContain(`href="${link.url}"`);
    }
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(6);
    expect(renderToStaticMarkup(<RobinhoodProjectLinks links={[]} name="Coin" />)).toBe("");
  });

  it("uses the supplied fallback only for missing or invalid artwork", () => {
    expect(renderToStaticMarkup(<RobinhoodCoinArtwork fallbackImageUrl={MODULE_TOKEN_FALLBACK_IMAGE} />)).toContain(`src="${MODULE_TOKEN_FALLBACK_IMAGE}"`);
    expect(renderToStaticMarkup(<RobinhoodCoinArtwork imageUrl="javascript:bad" fallbackImageUrl={MODULE_TOKEN_FALLBACK_IMAGE} />)).toContain(`src="${MODULE_TOKEN_FALLBACK_IMAGE}"`);
    const chosen = "https://example.com/chosen.png";
    const custom = renderToStaticMarkup(<RobinhoodCoinArtwork imageUrl={chosen} fallbackImageUrl={MODULE_TOKEN_FALLBACK_IMAGE} />);
    expect(custom).toContain(`src="${chosen}"`);
    expect(custom).not.toContain(`src="${MODULE_TOKEN_FALLBACK_IMAGE}"`);
    expect(renderToStaticMarkup(<RobinhoodCoinArtwork />)).not.toContain("<img");
  });
});
