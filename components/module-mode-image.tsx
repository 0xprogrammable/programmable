"use client";

import Image from "next/image";
import { ImagePlus, Link as LinkIcon, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { sha256 } from "viem";

import { prepareTokenImage } from "@/lib/token-image";
import { validateTokenImage, type ModuleModeImage } from "@/lib/module-mode/builder";
import styles from "@/components/module-mode-builder.module.css";

export interface ModuleModeImageResource { blob: Blob; objectUrl: string }

export function moduleModeImageSource(image: ModuleModeImage, resource: ModuleModeImageResource | null): string | null {
  if (image.kind === "local") return resource?.objectUrl ?? null;
  return image.kind === "uri" && !validateTokenImage(image) ? image.uri : null;
}

export function ModuleModeImagePicker({ image, resource, onChange, onBusyChange, error, onUndo }: {
  image: ModuleModeImage;
  resource: ModuleModeImageResource | null;
  onChange: (image: ModuleModeImage, resource: ModuleModeImageResource | null, checkpoint: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  error?: string;
  onUndo?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [preparationError, setPreparationError] = useState("");
  const [imageLoadError, setImageLoadError] = useState("");
  const source = moduleModeImageSource(image, resource);
  const message = preparationError || error;

  async function choose(file: File | undefined) {
    if (!file) return;
    setPreparing(true); onBusyChange(true); setPreparationError("");
    try {
      const blob = await prepareTokenImage(file);
      if (blob.type !== "image/webp") throw new Error("This browser could not prepare a WebP image. Use a public image link instead.");
      const digest = sha256(new Uint8Array(await blob.arrayBuffer()));
      const objectUrl = URL.createObjectURL(blob);
      onChange({ kind: "local", sha256: digest, mimeType: "image/webp", bytes: blob.size }, { blob, objectUrl }, true);
      setImageLoadError("");
    } catch (caught) { setPreparationError(caught instanceof Error ? caught.message : "The image could not be prepared. Your previous image is kept."); }
    finally { setPreparing(false); onBusyChange(false); }
  }

  return (
    <div className={styles.imageField}>
      <span className={styles.imageFieldLabel}>Token image</span>
      <div className={styles.imagePicker}>
        <div className={styles.imageThumbnail}>{source ? <Image src={source} alt="Your selected token image" fill sizes="80px" unoptimized onError={() => setImageLoadError("The image preview could not load. Check the public link or choose a file.")} /> : <ImagePlus size={24} aria-hidden="true" />}</div>
        <div className={styles.imagePickerContent}>
          <input ref={input} id="module-token-image-file" className={styles.liveRegion} type="file" accept="image/jpeg,image/png,image/webp" disabled={preparing} tabIndex={-1} aria-label="Choose token image file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void choose(file); }} />
          <div className={styles.imagePickerActions}>
            <button type="button" className={styles.secondaryButton} disabled={preparing} aria-busy={preparing} data-invalid={Boolean(message)} aria-describedby={`module-token-image-help module-token-image-status${message ? " module-token-image-error" : ""}`} onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />{image.kind === "local" ? "Change image" : "Choose image"}</button>
            {image.kind !== "none" ? <button type="button" className={styles.iconButton} disabled={preparing} aria-label="Remove token image" onClick={() => { onChange({ kind: "none" }, null, true); setPreparationError(""); setImageLoadError(""); }}><X size={18} aria-hidden="true" /></button> : null}
          </div>
          <p id="module-token-image-help" className={styles.help}>JPG, PNG or WebP. Up to 8 MB. Cropped to a square.</p>
          <p id="module-token-image-status" className={styles.help} role="status">{preparing ? "Preparing image…" : image.kind === "local" ? "Prepared on your device. It has not been uploaded." : image.kind === "uri" ? "Using a public image link. Its contents are not verified yet." : "Choose a file or use an existing public image link."}</p>
        </div>
      </div>
      {image.kind === "uri" ? <div className={styles.field}><label htmlFor="module-token-image-uri">Public image URL</label><input id="module-token-image-uri" type="url" value={image.uri} placeholder="https://…" autoComplete="off" spellCheck={false} disabled={preparing} aria-invalid={Boolean(error) || undefined} aria-describedby={message ? "module-token-image-error" : undefined} onChange={(event) => { onChange({ kind: "uri", uri: event.target.value, contentVerified: false }, null, false); setImageLoadError(""); }} /></div> : <button type="button" className={styles.textButton} disabled={preparing} onClick={() => { onChange({ kind: "uri", uri: "", contentVerified: false }, null, true); setPreparationError(""); }}><LinkIcon size={14} aria-hidden="true" /> Use an image link</button>}
      {message ? <p id="module-token-image-error" className={styles.fieldError}>{message}</p> : null}
      {imageLoadError ? <p className={styles.fieldError}>{imageLoadError}</p> : null}
      {onUndo ? <button type="button" className={styles.textButton} disabled={preparing} onClick={() => { onUndo(); setPreparationError(""); setImageLoadError(""); }}>Undo image change</button> : null}
    </div>
  );
}
