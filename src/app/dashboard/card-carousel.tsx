"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function CardCarousel({
  label,
  slides,
}: {
  label: string;
  slides: { id: string; content: ReactNode }[];
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const active = Math.min(position, slides.length - 1);

  if (slides.length === 0) return null;
  if (slides.length === 1) return slides[0].content;

  function scrollTo(index: number) {
    const track = viewport.current;
    if (!track) return;
    const first = track.children[0] as HTMLElement;
    const target = track.children[index] as HTMLElement | undefined;
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: target.offsetLeft - first.offsetLeft, behavior: reduceMotion ? "instant" : "smooth" });
  }

  return (
    <div role="group" aria-label={label} className="min-w-0">
      <div
        ref={viewport}
        onScroll={(event) => {
          const track = event.currentTarget;
          const first = track.children[0] as HTMLElement;
          const next = track.children[1] as HTMLElement;
          const step = next.offsetLeft - first.offsetLeft;
          if (step > 0) setPosition(Math.round(track.scrollLeft / step));
        }}
        className="dashboard-carousel"
      >
        {slides.map(({ id, content }) => <div key={id} className="min-w-0 snap-start">{content}</div>)}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 lg:hidden">
        <p className="text-xs font-medium text-muted-foreground" aria-live="polite">
          <span className="tabular-nums">{active + 1} / {slides.length}</span>
          <span aria-hidden="true" className="px-2">·</span>
          Гортайте картки
        </p>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" className="size-10 p-0" aria-label="Попередня картка" disabled={active === 0} onClick={() => scrollTo(active - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" className="size-10 p-0" aria-label="Наступна картка" disabled={active === slides.length - 1} onClick={() => scrollTo(active + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
