import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileProjectsLoadingState } from "@/components/profile-projects";
import { beginPublicProfileRefresh, PublicCreatorProfile, RobinhoodProfileRewards } from "@/components/profile-view";
import { ProfileLoadingSkeleton } from "@/components/profile-skeleton";
import { loadingProfileData, type ProfileOnchainData } from "@/lib/profile/onchain-profile";
import { RobinhoodProfileLaunches } from "@/components/robinhood-profile-launches";
import { readLocalProfile, writeLocalProfile } from "@/lib/profile/local-profile";

const creator = "0x245099E77F8F0Cad9a75B1B56db8FDE7C948d5B1";
const connected = `0x${"a".repeat(40)}`;

describe("shared wallet profile", () => {
  it("retains only a ready launch snapshot belonging to the same wallet and chain", () => {
    const ready: ProfileOnchainData = { ...loadingProfileData(creator), status: "ready", chainId: 1 };
    expect(beginPublicProfileRefresh(ready, creator.toLowerCase())).toBe(ready);
    expect(beginPublicProfileRefresh(ready, connected)).toEqual(loadingProfileData(connected));
    expect(beginPublicProfileRefresh({ ...ready, chainId: 4663 as 1 }, creator)).toMatchObject({ status: "loading", tokens: [] });
    expect(beginPublicProfileRefresh({ ...ready, status: "error" }, creator)).toMatchObject({ status: "loading", tokens: [] });
  });

  it("keeps the initial skeleton free of account identity and focusable dummy controls", () => {
    const html = renderToStaticMarkup(<ProfileLoadingSkeleton label="Loading profile" showHero />);
    expect(html).toContain("Loading profile");
    expect(html).toContain("profileSkeletonChain");
    expect(html).not.toContain(creator);
    expect(html).not.toContain("<button");
    expect(html.match(/class="[^"]*skeletonProject[^"]*"/g)).toHaveLength(1);
  });
  it("uses the same launch loading structure for both chains", () => {
    const ethereum = renderToStaticMarkup(<ProfileProjectsLoadingState />);
    const robinhood = renderToStaticMarkup(<RobinhoodProfileLaunches account={creator} />);
    expect(robinhood).toBe(ethereum);
    expect(robinhood.match(/class="[^"]*skeletonProject[^"]*"/g)).toHaveLength(1);
  });

  it("keeps fee and claim sections without implying a generic custom-hook payout", () => {
    const html = renderToStaticMarkup(<RobinhoodProfileRewards />);
    expect(html).toContain("Fees earned");
    expect(html).toContain("Claim rewards");
    expect(html).toContain("Not available");
    expect(html).toContain("Custom hooks manage their own fees and claims.");
    expect(html).not.toContain("0 ETH");
    expect(html).not.toContain("<button");
  });

  it.each([1, 4663] as const)("identifies a public wallet and offers the signed-in profile on chain %s", (viewChainId) => {
    const html = renderToStaticMarkup(<PublicCreatorProfile
      account={creator} connectedAccount={connected} onConnect={() => {}} viewChainId={viewChainId}
    />);
    expect(html).toContain(`Profile wallet ${creator}`);
    expect(html).toContain('href="/profile">My profile</a>');
    expect(html).toContain("another wallet");
    expect(html).not.toContain("Edit profile");
    if (viewChainId === 4663) expect(html).toContain("Claim rewards");
    else expect(html).not.toContain("Claim rewards");
    expect(html).not.toContain("Review claim");
    expect(html).not.toContain("Confirm claim in wallet");
  });

  it("keeps username, avatar and banner under one wallet identity", () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
      removeItem: (key: string) => { entries.delete(key); },
    };
    const profile = { username: "Builder", avatarDataUrl: "data:image/png;base64,aGVsbG8=", bannerDataUrl: "data:image/png;base64,d29ybGQ=", bio: "On both chains." };
    writeLocalProfile(storage, creator, profile);
    expect(readLocalProfile(storage, creator.toLowerCase())).toMatchObject(profile);
    expect(readLocalProfile(storage, connected)).toEqual({ username: "", avatarDataUrl: "" });
    expect(entries.size).toBe(1);
  });
});
