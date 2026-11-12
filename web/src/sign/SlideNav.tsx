import { useEffect, useRef } from 'react';
import { PLUGIN_SLIDE_RENDERERS } from '../../../plugins/web/sign';
import { slideTypeLabel, type AnySlide, type SlideType } from '../../../shared/types';

/**
 * The bottom navigation bar: transport controls plus one labelled chip per
 * slide, so someone at the panel can jump straight to the slide they want
 * instead of pressing "next" until it comes round.
 *
 * It shares the controls' visibility window rather than sitting on screen
 * permanently — a strip that never moves is a burn-in risk on a display that
 * runs unattended for months, and it would cover the bottom of every slide.
 */

/**
 * A chip needs a shorter word than the panel's label. Core types are here;
 * every other type's chip comes from the plugin that owns it, and one with no
 * chip of its own falls back to the panel's label rather than going blank.
 */
const SHORT_LABELS: Record<string, string> = {
  image: 'Image',
  video: 'Video',
};

function shortLabel(type: string): string {
  return SHORT_LABELS[type] ?? PLUGIN_SLIDE_RENDERERS[type]?.nav?.label ?? slideTypeLabel(type);
}

function SlideIcon({ type }: { type: SlideType }) {
  const common = {
    viewBox: '0 0 24 24',
    className: 'sign-nav__icon',
    'aria-hidden': true,
    focusable: false,
  } as const;

  switch (type) {
    case 'image':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.8" />
          <path d="M4 17l4.5-5 3.5 3.5 3-2.5L20 17" strokeLinejoin="round" />
        </svg>
      );
    case 'video':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M10.5 9.5l5 2.5-5 2.5z" fill="currentColor" strokeLinejoin="round" />
        </svg>
      );
    default:
      return <>{PLUGIN_SLIDE_RENDERERS[type]?.nav?.icon ?? null}</>;
  }
}

export interface SlideNavProps {
  slides: AnySlide[];
  index: number;
  visible: boolean;
  paused: boolean;
  onGoTo: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePaused: () => void;
}

export function SlideNav({
  slides,
  index,
  visible,
  paused,
  onGoTo,
  onPrevious,
  onNext,
  onTogglePaused,
}: SlideNavProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const currentRef = useRef<HTMLButtonElement | null>(null);

  // Center the current chip. Done by hand rather than with scrollIntoView,
  // which on a fullscreen sign can end up scrolling an ancestor as well.
  useEffect(() => {
    const track = trackRef.current;
    const chip = currentRef.current;
    if (!track || !chip || !visible) return;
    const target = chip.offsetLeft - (track.clientWidth - chip.offsetWidth) / 2;
    track.scrollLeft = Math.max(0, target);
  }, [index, visible, slides.length]);

  if (slides.length <= 1) return null;

  return (
    <nav
      className={`sign-nav ${visible ? 'is-visible' : ''}`}
      aria-label="Slides"
      aria-hidden={!visible}
    >
      <div className="sign-nav__transport">
        <button
          type="button"
          className="sign-nav__button"
          onClick={onPrevious}
          aria-label="Previous slide"
        >
          ‹
        </button>
        <button
          type="button"
          className="sign-nav__button"
          onClick={onTogglePaused}
          aria-label={paused ? 'Resume the slideshow' : 'Pause the slideshow'}
        >
          {paused ? '▶' : '❚❚'}
        </button>
        <button
          type="button"
          className="sign-nav__button"
          onClick={onNext}
          aria-label="Next slide"
        >
          ›
        </button>
      </div>

      <div className="sign-nav__track" ref={trackRef}>
        {slides.map((slide, position) => {
          const isCurrent = position === show(index, slides.length);
          return (
            <button
              key={slide.id}
              type="button"
              ref={isCurrent ? currentRef : undefined}
              className={`sign-nav__chip ${isCurrent ? 'is-current' : ''}`}
              onClick={() => onGoTo(position)}
              aria-current={isCurrent ? 'true' : undefined}
              aria-label={`${slide.title || slideTypeLabel(slide.type)} — ${slideTypeLabel(
                slide.type,
              )}, slide ${position + 1} of ${slides.length}`}
            >
              <SlideIcon type={slide.type} />
              <span className="sign-nav__text">
                <span className="sign-nav__title">
                  {slide.title || slideTypeLabel(slide.type)}
                </span>
                <span className="sign-nav__kind">{shortLabel(slide.type)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Guards against an index left over from a longer playlist. */
function show(index: number, count: number): number {
  if (count === 0) return -1;
  return ((index % count) + count) % count;
}
