"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import Image from "next/image";

import { LandingExploreGate } from "@/components/landing-explore-gate";
import styles from "@/components/landing-page.module.css";

const loopMark = "/brand/loop/programmable-loop-mark-header-white-v1-1536.png";
const HERO_TWINKLE_COUNT = 120;

type HeroStarStyle = CSSProperties & {
  "--hero-star-delay": string;
  "--hero-star-duration": string;
  "--hero-star-size": string;
};

function heroStarStyle(index: number): HeroStarStyle {
  const horizontal = (index * 47.13 + 19.7) % 96;
  const vertical = (index * 29.71 + 7.3) % 62;
  const duration = 2.8 + ((index * 17) % 29) / 10;
  const delay = -((index * 23) % 97) / 10;
  const sizeStep = ((index * 7) % 11) / 20;
  const emphasis = index % 29 === 0 ? 0.5 : index % 13 === 0 ? 0.26 : 0;
  const size = 0.64 + sizeStep + emphasis;

  return {
    left: `${horizontal + 2}%`,
    top: `${vertical + 1}%`,
    "--hero-star-delay": `${delay}s`,
    "--hero-star-duration": `${duration}s`,
    "--hero-star-size": `${size}px`,
  };
}

export function LandingPage() {
  const pageRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const alignLandingHash = () => {
      if (window.location.hash === "") {
        window.scrollTo({ behavior: "auto", left: 0, top: 0 });
        return;
      }

      if (window.location.hash !== "#explore") return;

      const chapter = document.getElementById("explore");
      const header = document.querySelector<HTMLElement>(".header-inner");
      if (chapter) chapter.dataset.visible = "true";
      const target = chapter?.querySelector<HTMLElement>("[data-explore-heading]") ?? chapter;
      if (!target) return;

      const headerHeight = header?.getBoundingClientRect().height ?? 0;
      const breathingRoom = window.innerWidth <= 960 ? 16 : 24;
      const top =
        window.scrollY +
        target.getBoundingClientRect().top -
        headerHeight -
        breathingRoom;

      window.scrollTo({ behavior: "auto", left: 0, top });
    };

    alignLandingHash();
    window.addEventListener("hashchange", alignLandingHash);
    return () => window.removeEventListener("hashchange", alignLandingHash);
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const sections = Array.from(
      page.querySelectorAll<HTMLElement>("[data-reveal-section]"),
    );

    page.dataset.revealReady = "true";

    if (!("IntersectionObserver" in window)) {
      sections.forEach((section) => {
        section.dataset.visible = "true";
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const section = entry.target as HTMLElement;
          section.dataset.visible = "true";
          observer.unobserve(section);
        });
      },
      {
        rootMargin: "0px 0px 48% 0px",
        threshold: 0.12,
      },
    );

    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);

  return (
    <article ref={pageRef} className={`${styles.page} landing-page-root`}>
      <section
        className={styles.hero}
        id="intro"
        aria-labelledby="landing-title"
      >
        <div className={styles.heroArtwork} aria-hidden="true">
          <picture className={styles.heroGardenFrame}>
            <source
              media="(max-width: 42.5rem)"
              srcSet="/brand/atmosphere/programmable-floral-foreground-mobile-v1.avif"
              type="image/avif"
            />
            <source
              media="(max-width: 60rem)"
              srcSet="/brand/atmosphere/programmable-floral-foreground-tablet-v1.avif"
              type="image/avif"
            />
            <Image
              className={styles.heroGarden}
              src="/brand/atmosphere/programmable-floral-foreground-v1.avif"
              alt=""
              fill
              fetchPriority="high"
              loading="eager"
              sizes="100vw"
            />
          </picture>
          <span className={styles.heroTwinkles}>
            {Array.from({ length: HERO_TWINKLE_COUNT }, (_, index) => (
              <i key={index} style={heroStarStyle(index)} />
            ))}
          </span>
        </div>

        <div className={styles.heroContent}>
          <Image
            className={styles.heroLogo}
            src={loopMark}
            alt=""
            width={1168}
            height={1536}
            sizes="80px"
            priority
          />
          <h1 id="landing-title">Programmable</h1>
          <p>Build and launch custom Uniswap v4 hooks</p>
        </div>

        <a className={styles.scrollCue} href="#explore">
          <span>Discover Programmable</span>
          <span aria-hidden="true">↓</span>
        </a>
      </section>

      <div
        className={`${styles.exploreChapter} ${styles.revealSection}`}
        id="explore"
        data-reveal-section
      >
        <LandingExploreGate />
      </div>
    </article>
  );
}
