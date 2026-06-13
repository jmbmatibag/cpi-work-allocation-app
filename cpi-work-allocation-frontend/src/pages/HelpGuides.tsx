import { useEffect, useRef, useState } from "react";
import { HelpCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { ONBOARDING_GUIDES } from "@/lib/onboardingGuides";

/**
 * Centralized Help center (Epic 3).
 *
 * A permanent, docs-style reference for every workspace feature — for users
 * who dismissed the first-run pop-ups. Content is sourced from
 * ONBOARDING_GUIDES (the same definitions the per-page tip modals use), so the
 * copy here never drifts from the modals.
 *
 * Layout: a sticky "On this page" table of contents with scroll-spy on the
 * left, and the guides rendered as numbered step timelines on the right.
 */

/** Trim the verbose "How to use ..." prefix for the compact TOC labels. */
const tocLabel = (title: string) => title.replace(/^How to use (the )?/i, "");

const HelpGuides = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState(ONBOARDING_GUIDES[0]?.id ?? "");

  // Scroll-spy: highlight the TOC entry whose section is currently in view.
  // The observer's root is the scroll container (not the window), since the
  // page scrolls inside a fixed-height region below the app header.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const sections = ONBOARDING_GUIDES.map((g) =>
      document.getElementById(g.id),
    ).filter((el): el is HTMLElement => el !== null);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      // A band roughly in the upper third of the viewport decides "active".
      { root, rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div ref={scrollRef} className="h-[calc(100vh-3rem)] overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Hero */}
        <header className="mb-10">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 rounded-full px-3 py-1 mb-4">
            <HelpCircle className="h-3.5 w-3.5" />
            Help Center
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            User Guides
          </h1>
          <p className="text-base text-muted-foreground mt-2 max-w-2xl leading-relaxed">
            Everything you need to get the most out of the Work Allocation
            Portal. These are the same walkthroughs shown the first time you
            open each page — kept here for whenever you need a refresher.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[210px_1fr] gap-10">
          {/* Table of contents */}
          <nav className="hidden lg:block">
            <div className="sticky top-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-3 px-2.5">
                On this page
              </p>
              <ul className="space-y-1">
                {ONBOARDING_GUIDES.map((g) => {
                  const Icon = g.icon;
                  const active = g.id === activeId;
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => scrollTo(g.id)}
                        className={cn(
                          "flex items-center gap-2 w-full text-left rounded-md px-2.5 py-1.5 text-sm transition-colors",
                          active
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{tocLabel(g.title)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>

          {/* Guides */}
          <div className="space-y-14 min-w-0">
            {ONBOARDING_GUIDES.map((guide) => {
              const Icon = guide.icon;
              return (
                <section key={guide.id} id={guide.id} className="scroll-mt-6">
                  {/* Section header */}
                  <div className="flex items-start gap-4 mb-6">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary shrink-0">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-foreground">
                        {guide.title}
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        {guide.subtitle}
                      </p>
                    </div>
                  </div>

                  {/* Steps — vertical numbered timeline */}
                  <ol className="relative border-l border-border/60 ml-5 space-y-6">
                    {guide.tips.map((tip, i) => (
                      <li key={tip.heading} className="relative pl-8">
                        <span className="absolute -left-[13px] top-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-[11px] font-bold ring-4 ring-background">
                          {i + 1}
                        </span>
                        <p className="text-sm font-semibold text-foreground">
                          {tip.heading}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          {tip.body}
                        </p>
                      </li>
                    ))}
                  </ol>

                  {/* Optional footnote callout */}
                  {guide.note && (
                    <div className="mt-6 flex gap-3 rounded-lg border border-primary/15 bg-primary/[0.04] p-3.5">
                      <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <p className="text-[13px] text-muted-foreground leading-relaxed">
                        {guide.note}
                      </p>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpGuides;
