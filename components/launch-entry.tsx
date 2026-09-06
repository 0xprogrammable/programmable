"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import launchExperience from "@/components/launch-experience.module.css";
import { ProfileChainSelector } from "@/components/profile-chain-selector";
import { useViewChain, type ViewChainId } from "@/components/view-chain";
import { isConfiguredClassicV3ReleaseReady } from "@/lib/classic-v3-release";
import { resolveImplementedLaunchModel } from "@/lib/launch-model-gating";
import type { LaunchModel } from "@/lib/launch";
import { DEFAULT_VIEW_CHAIN_ID } from "@/lib/view-chain";

const launchEnvironment =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const classicV3LaunchAvailable =
  isConfiguredClassicV3ReleaseReady(launchEnvironment);

function loadLaunchForm() {
  return import("@/components/launch-builder");
}

type LaunchBuilderComponent =
  (typeof import("@/components/launch-builder"))["LaunchBuilderForm"];
type LaunchPickerChoice = LaunchModel;

function LaunchArtworkImage() {
  const [ready, setReady] = useState(false);
  return (
    <Image
      className={launchExperience.artImage}
      src="/brand/atmosphere/programmable-floral-hooks-v1.webp"
      alt=""
      fill
      sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1280px) calc((100vw - 96px) / 2), 624px"
      priority
      data-ready={ready}
      onLoad={() => setReady(true)}
    />
  );
}

export function LaunchExperience({
  initialViewChainId = DEFAULT_VIEW_CHAIN_ID,
}: Readonly<{ initialViewChainId?: ViewChainId }>) {
  const { hydrated, viewChainId, setViewChainId } = useViewChain();
  return (
    <LaunchExperienceRuntime
      chainId={hydrated ? viewChainId : initialViewChainId}
      onChangeChain={setViewChainId}
    />
  );
}

function LaunchExperienceRuntime({
  chainId,
  onChangeChain,
}: Readonly<{
  chainId: ViewChainId;
  onChangeChain: (chainId: ViewChainId) => void;
}>) {
  const [selectedModel, setSelectedModel] = useState<LaunchPickerChoice | null>(null);
  const [loadedLaunchBuilder, setLoadedLaunchBuilder] =
    useState<LaunchBuilderComponent | null>(null);
  const [preparingModel, setPreparingModel] = useState<LaunchModel | null>(null);
  const [modelLoadError, setModelLoadError] = useState("");

  useEffect(() => {
    if (chainId !== 1 || !classicV3LaunchAvailable) return;
    void loadLaunchForm().catch(() => undefined);
  }, [chainId]);

  async function chooseModel(candidate: LaunchPickerChoice) {
    const model = resolveImplementedLaunchModel(candidate);
    if (
      chainId !== 1 ||
      !model ||
      model === "deep" ||
      model === "stock-paired" ||
      (model === "classic-v3" && !classicV3LaunchAvailable)
    ) {
      return;
    }

    setPreparingModel(model);
    setModelLoadError("");

    try {
      const launchModule = await loadLaunchForm();
      setLoadedLaunchBuilder(() => launchModule.LaunchBuilderForm);
      window.scrollTo({ left: 0, top: 0, behavior: "auto" });
      setSelectedModel(model);
    } catch {
      setModelLoadError("Classic could not open. Try again.");
    } finally {
      setPreparingModel(null);
    }
  }

  function returnToModels() {
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    setSelectedModel(null);
  }

  if (!selectedModel || chainId !== 1) {
    return (
      <LaunchModelPicker
        chainId={chainId}
        onChangeChain={(nextChainId) => {
          setSelectedModel(null);
          setModelLoadError("");
          onChangeChain(nextChainId);
        }}
        modelLoadError={modelLoadError}
        onChoose={chooseModel}
        preparingModel={preparingModel}
      />
    );
  }

  if (!loadedLaunchBuilder) return null;

  const LoadedLaunchBuilder = loadedLaunchBuilder;
  return (
    <LoadedLaunchBuilder
      model={selectedModel}
      onBackToModels={returnToModels}
      stockPairedPublicLaunchEnabled={false}
    />
  );
}

export function LaunchModelPicker({
  chainId = DEFAULT_VIEW_CHAIN_ID,
  onChangeChain,
  modelLoadError = "",
  onChoose,
  preparingModel = null,
}: {
  chainId?: ViewChainId;
  onChangeChain?: (chainId: ViewChainId) => void;
  modelLoadError?: string;
  onChoose: (model: LaunchPickerChoice) => void | Promise<void>;
  preparingModel?: LaunchModel | null;
}) {
  const isEthereum = chainId === 1;
  const preloadAvailableForm = () => {
    void loadLaunchForm().catch(() => undefined);
  };

  const customCardContent = (
    <>
      <span
        className={`launch-model-art ${launchExperience.modelArt} ${launchExperience.customArt}`}
        aria-hidden="true"
      >
        <LaunchArtworkImage />
        <Image
          className={`${launchExperience.classicLogo} ${launchExperience.customLogo}`}
          src="/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"
          alt=""
          width={1536}
          height={1536}
          sizes="128px"
        />
      </span>
      <span
        className={`launch-model-card-body ${launchExperience.modelBody}`}
      >
        <span
          className={`launch-model-card-heading ${launchExperience.modelHeading}`}
        >
          <strong id="launch-model-custom-title">Custom V4 Hook</strong>
        </span>
        <span
          className={`launch-model-description ${launchExperience.modelDescription}`}
          id="launch-model-custom-description"
        >
          Build your own Uniswap v4 hook and submit it with an API key.
          Your wallet reviews and signs the launch.
        </span>
        <span
          className={`launch-model-action ${launchExperience.modelAction}`}
        >
          Open Custom V4 Hook
          <ArrowRight aria-hidden="true" size={16} />
        </span>
      </span>
    </>
  );

  return (
    <div
      className={`launch-model-page page-width ${launchExperience.pickerPage}`}
    >
      <header
        className={`launch-model-heading ${launchExperience.pickerHeading}`}
      >
        <h1 className="sr-only">Launch</h1>
        <ProfileChainSelector
          className={launchExperience.chainChoice}
          label="Launch chain"
          name="launch-chain"
          value={chainId}
          onChange={onChangeChain}
          disabled={preparingModel !== null}
        />
      </header>

      <div
        key={chainId}
        className={`launch-model-grid ${launchExperience.modelGrid}`}
      >
        {isEthereum ? (
          <button
            className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
            data-launch-model-option="classic"
            data-launch-model-available={classicV3LaunchAvailable}
            data-launch-model-launchable={classicV3LaunchAvailable}
            type="button"
            disabled={!classicV3LaunchAvailable || preparingModel !== null}
            aria-busy={preparingModel === "classic-v3"}
            aria-labelledby="launch-model-classic-title"
            aria-describedby={classicV3LaunchAvailable ? "launch-model-classic-description" : "launch-model-classic-description launch-model-classic-status"}
            onPointerEnter={
              classicV3LaunchAvailable ? preloadAvailableForm : undefined
            }
            onPointerDown={
              classicV3LaunchAvailable ? preloadAvailableForm : undefined
            }
            onFocus={classicV3LaunchAvailable ? preloadAvailableForm : undefined}
            onClick={() => void onChoose("classic-v3")}
          >
            <span
              className={`launch-model-art launch-model-art-classic ${launchExperience.modelArt} ${launchExperience.classicArt}`}
              aria-hidden="true"
            >
              <LaunchArtworkImage />
              <Image
                className={launchExperience.classicLogo}
                src="/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"
                alt=""
                width={1536}
                height={1536}
                sizes="128px"
              />
            </span>

            <span
              className={`launch-model-card-body ${launchExperience.modelBody}`}
            >
              <span
                className={`launch-model-card-heading ${launchExperience.modelHeading}`}
              >
                <strong id="launch-model-classic-title">Classic</strong>
                {!classicV3LaunchAvailable ? <small
                  id="launch-model-classic-status"
                  data-status="pending"
                >
                  Unavailable
                </small> : null}
              </span>
              <span
                className={`launch-model-description ${launchExperience.modelDescription}`}
                id="launch-model-classic-description"
              >
                Launch a fixed-supply token with permanently locked, one-sided
                Uniswap v4 liquidity. Set buy and sell fees, reward recipients,
                and the initial buy before you sign.
              </span>
              {classicV3LaunchAvailable ? (
                <span
                  className={`launch-model-action ${launchExperience.modelAction}`}
                >
                  {preparingModel === "classic-v3"
                    ? "Opening Classic"
                    : "Launch a Classic Coin"}
                  <ArrowRight aria-hidden="true" size={16} />
                </span>
              ) : null}
            </span>
          </button>
        ) : (
          <Link
            className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
            data-launch-model-option="modules"
            data-launch-model-available="true"
            data-launch-model-launchable="false"
            href="/launch/modules"
            aria-labelledby="launch-model-modules-title"
            aria-describedby="launch-model-modules-description launch-model-modules-status"
          >
            <span className={`${launchExperience.modelArt} ${launchExperience.moduleArt}`} aria-hidden="true">
              <span className={launchExperience.moduleStack}>
                <span className={launchExperience.modulePiece}><span>01</span><strong>Your coin</strong><span>●</span></span>
                <span className={launchExperience.modulePiece}><span>02</span><strong>Your fees</strong><span>%</span></span>
                <span className={launchExperience.modulePiece}><span>03</span><strong>Your modules</strong><span>+</span></span>
              </span>
            </span>
            <span className={`launch-model-card-body ${launchExperience.modelBody}`}>
              <span className={`launch-model-card-heading ${launchExperience.modelHeading}`}>
                <strong id="launch-model-modules-title">Module Mode</strong>
                <small id="launch-model-modules-status">Preview</small>
              </span>
              <span className={`launch-model-description ${launchExperience.modelDescription}`} id="launch-model-modules-description">
                Start with a simple coin. Set your swap fees and add optional modules to make it yours.
              </span>
              <span className={`launch-model-action ${launchExperience.modelAction}`}>
                Open builder <ArrowRight aria-hidden="true" size={16} />
              </span>
            </span>
          </Link>
        )}

        <Link
          className={`launch-model-card ${launchExperience.modelCard} liquid-glass-surface`}
          data-launch-model-option="custom"
          data-launch-model-available="true"
          data-launch-model-entry="api-key-launch"
          data-launch-model-launchable="false"
          href="/developers/api-keys"
          aria-labelledby="launch-model-custom-title"
          aria-describedby="launch-model-custom-description"
        >
          {customCardContent}
        </Link>

      </div>
      {modelLoadError ? (
        <p className={launchExperience.modelLoadError} role="alert">
          {modelLoadError}
        </p>
      ) : null}
    </div>
  );
}
