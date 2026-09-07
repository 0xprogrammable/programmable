"use client";

import Image from "next/image";
import { useState } from "react";
import { safePublicImageUrl } from "@/lib/safe-public-image-url";
import { getTokenCardImageSource } from "@/lib/token-image";
import styles from "./robinhood-coin-artwork.module.css";

export const MODULE_TOKEN_FALLBACK_IMAGE = "/brand/loop/programmable-module-token-default-v1.png";

export function RobinhoodCoinArtwork({ imageUrl, fallbackImageUrl, loading = false, eager = false, className = "" }: {
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  loading?: boolean;
  eager?: boolean;
  className?: string;
}) {
  const safeSource = safePublicImageUrl(imageUrl);
  const safeFallback = safePublicImageUrl(fallbackImageUrl);
  const source = safeSource ? getTokenCardImageSource(safeSource) : null;
  const fallback = safeFallback ? getTokenCardImageSource(safeFallback) : null;
  return <ArtworkImage key={`${source}:${fallback}`} source={source ?? fallback} fallback={fallback} loading={loading} eager={eager} className={className} />;
}

function ArtworkImage({ source, fallback, loading, eager, className }: {
  source: string | null;
  fallback: string | null;
  loading: boolean;
  eager: boolean;
  className: string;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [useFallback, setUseFallback] = useState(false);
  const currentSource = useFallback ? fallback : source;
  const pending = currentSource ? status === "loading" : loading;

  return <div className={`${styles.artwork} ${className}`} data-loading={pending} aria-hidden="true">
    {currentSource && status !== "failed" ? <Image
      key={currentSource}
      src={currentSource} alt="" width={600} height={600} unoptimized
      loading={eager ? "eager" : "lazy"}
      className={status === "ready" ? styles.loaded : undefined}
      onLoad={() => setStatus("ready")}
      onError={() => {
        if (!useFallback && fallback && fallback !== source) {
          setUseFallback(true);
          setStatus("loading");
        } else setStatus("failed");
      }}
    /> : null}
  </div>;
}
