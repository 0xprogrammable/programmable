import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

async function alphaBounds(path: string, threshold = 16) {
  const { data, info } = await sharp(join(root, path))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (alpha < threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  return {
    width: right - left + 1,
    height: bottom - top + 1,
    top,
    bottom,
    canvasWidth: info.width,
    canvasHeight: info.height,
  };
}

describe("Programmable branding assets", () => {
  it("keeps the browser tab branded only as Programmable on every route", () => {
    const metadataSources = [
      "app/layout.tsx",
      "app/page.tsx",
      "app/explore/page.tsx",
      "app/launch/page.tsx",
      "app/docs/layout.tsx",
      "app/docs/developers/page.tsx",
      "app/docs/models/[model]/page.tsx",
    ].map(read);

    for (const source of metadataSources) {
      expect(source).toContain('title: "Programmable"');
    }

    const combinedSources = metadataSources.join("\n");
    for (const routeSpecificTitle of [
      'title: "Programmable — Launch what you imagine"',
      'title: "Explore — Programmable"',
      'title: "Create · Programmable"',
      'default: "Docs · Programmable"',
      'template: "%s · Programmable Docs"',
      'title: "Developer integrations"',
      "title: metadata.title",
    ]) {
      expect(combinedSources).not.toContain(routeSpecificTitle);
    }
  });

  it("uses the compact, transparent loop asset without enlarging the header hit box", () => {
    const navigation = read("components/site-navigation.tsx");
    const css = read("app/interface.css");

    expect(navigation).toContain(
      'src="/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"',
    );
    expect(css).toMatch(
      /\.wordmark-logo\s*{[^}]*height: 30px;[^}]*width: auto;/s,
    );
    expect(css).toMatch(
      /\.wordmark,\s*\.header-social-link\s*{[^}]*height: 44px;[^}]*width: 44px;/s,
    );
  });

  it("uses the current Warm Ivory loop mark in the Privy login modal", () => {
    const walletProvider = read("components/wallet-provider.tsx");

    expect(walletProvider).toContain(
      'logo: "/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"',
    );
    expect(walletProvider).not.toContain('logo: "/icon-512.png"');
  });

  it("binds metadata to the cache-busted, tightly framed favicon set", () => {
    const layout = read("app/layout.tsx");

    expect(layout).toContain('url: "/favicon-warm-ivory-v1.ico"');
    expect(layout).toContain('url: "/favicon-warm-ivory-v1-16x16.png"');
    expect(layout).toContain('url: "/favicon-warm-ivory-v1-32x32.png"');
    expect(layout).toContain('url: "/favicon-warm-ivory-v1-48x48.png"');
  });

  it("keeps the Warm Ivory favicon transparent and tightly framed", async () => {
    const current = await alphaBounds(
      "public/favicon-warm-ivory-v1-16x16.png",
    );
    const { data, info } = await sharp(
      join(root, "public/favicon-warm-ivory-v1-48x48.png"),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const coreColors: Array<[number, number, number]> = [];

    for (let index = 0; index < data.length; index += info.channels) {
      if (data[index + 3] < 250) continue;
      coreColors.push([data[index], data[index + 1], data[index + 2]]);
    }

    expect(current.canvasWidth).toBe(16);
    expect(current.canvasHeight).toBe(16);
    expect(current.top).toBeLessThanOrEqual(1);
    expect(current.bottom).toBeGreaterThanOrEqual(14);
    expect(coreColors.length).toBeGreaterThan(0);
    expect(coreColors).toContainEqual([248, 240, 233]);
    expect(
      coreColors.every(
        ([red, green, blue]) =>
          red >= 248 && red <= 252 &&
          green >= 240 && green <= 244 &&
          blue >= 233 && blue <= 237,
      ),
    ).toBe(true);
  });

  it("uses the centered Warm Ivory Night Garden social preview at both exact sizes", async () => {
    const layout = read("app/layout.tsx");
    const docs = read("app/docs/developers/page.tsx");
    const expected = [
      ["public/og/programmable-night-garden-loop-og-v2-1200x630.png", 1200, 630],
      ["public/og/programmable-night-garden-loop-og-v2-2400x1260.png", 2400, 1260],
    ] as const;

    expect(layout).toContain(
      '"/og/programmable-night-garden-loop-og-v2-1200x630.png"',
    );
    expect(docs).toContain(
      'url: "/og/programmable-night-garden-loop-og-v2-1200x630.png"',
    );
    expect(layout).not.toContain(
      '"/og/programmable-night-garden-og-1200x630.png"',
    );

    for (const [path, width, height] of expected) {
      const metadata = await sharp(join(root, path)).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(width);
      expect(metadata.height).toBe(height);
      expect(metadata.space).toBe("srgb");
      expect(metadata.hasAlpha).toBe(false);
      expect(statSync(join(root, path)).size).toBeLessThan(5 * 1024 * 1024);
    }

    const { data, info } = await sharp(
      join(root, "public/og/programmable-night-garden-loop-og-v2-1200x630.png"),
    )
      .extract({ left: 400, top: 130, width: 400, height: 370 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let ivoryPixels = 0;
    for (let index = 0; index < data.length; index += info.channels) {
      if (
        data[index] >= 244 &&
        data[index + 1] >= 236 &&
        data[index + 2] >= 229
      ) {
        ivoryPixels += 1;
      }
    }
    expect(ivoryPixels).toBeGreaterThan(10_000);
  });
});
