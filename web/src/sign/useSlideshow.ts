import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnySlide, VideoSlideConfig } from '../../../shared/types';

/** Horizontal travel, in pixels, that counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD_PX = 60;
/** Vertical travel above which the gesture is treated as a scroll, not a swipe. */
const SWIPE_MAX_DRIFT_PX = 80;
/**
 * Movement in any direction past this is a drag, not a tap. Scrolling the issue
 * list must not also drill into whichever row the finger started on.
 */
const TAP_SLOP_PX = 10;
/**
 * How long the on-screen controls stay up after the last touch. While hidden
 * they are `pointer-events: none`, so the first tap anywhere only wakes them —
 * this window has to be long enough for someone to then reach up and press
 * one, which five seconds is not.
 */
const CONTROLS_VISIBLE_MS = 10_000;
/**
 * The slide follows the finger at a fraction of its travel, capped. Damping
 * keeps the gap at the edge of the screen small — there is no neighbouring
 * slide rendered behind it, and pre-rendering one would mean a second Jira
 * fetch on a player that does not have the headroom.
 */
const DRAG_FOLLOW = 0.4;
const DRAG_MAX_PX = 120;
const DRAG_SETTLE = 'transform 220ms ease-out';
/**
 * Anything matching this is not "empty space", so tapping it does not dismiss
 * the nav bar. Covers the bar itself and every kind of tappable slide content.
 */
const DISMISS_EXEMPT = 'button, a, input, select, textarea, .sign-nav, .is-tappable';

export interface SlideshowState {
  current: AnySlide | undefined;
  index: number;
  count: number;
  paused: boolean;
  controlsVisible: boolean;
  next: () => void;
  previous: () => void;
  goTo: (index: number) => void;
  togglePaused: () => void;
  /** A video slide calls this when playback ends, to hand control back. */
  notifySlideFinished: (slideId: string) => void;
  /**
   * Attach to the element wrapping the slide. It is moved directly, without a
   * re-render, so dragging does not re-render the slide tree on every frame.
   */
  dragRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Spread onto the fullscreen container to enable touch and keyboard input. */
  containerProps: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
    onClickCapture: (event: React.MouseEvent) => void;
  };
}

/** True when the slide advances on its own signal rather than on a timer. */
function isSelfTimed(slide: AnySlide | undefined): boolean {
  if (!slide || slide.type !== 'video') return false;
  const config = slide.config as VideoSlideConfig;
  return config.useVideoDuration && !config.loop;
}

/**
 * @param suspended Halts the loop entirely, for while a drill-in overlay is
 * open. Distinct from `paused`, which is the brief pause a stray tap causes.
 */
export function useSlideshow(
  slides: AnySlide[],
  resumeAfterIdleSeconds: number,
  suspended = false,
): SlideshowState {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);

  const advanceTimerRef = useRef<number | undefined>(undefined);
  const resumeTimerRef = useRef<number | undefined>(undefined);
  const controlsTimerRef = useRef<number | undefined>(undefined);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<HTMLDivElement | null>(null);
  const draggedRef = useRef(false);
  // Read inside the pointer callbacks, which must not be rebuilt every time the
  // bar shows or hides.
  const controlsVisibleRef = useRef(false);
  controlsVisibleRef.current = controlsVisible;

  const count = slides.length;
  const current = slides[index];

  // Read inside callbacks that must not change identity when the position
  // does, otherwise the advance timer would be rebuilt on every tick.
  const currentIndexRef = useRef(index);
  currentIndexRef.current = index;
  const currentIdRef = useRef(current?.id);
  currentIdRef.current = current?.id;

  // Keep showing the same slide across a content update when it still exists,
  // so an unrelated edit does not jump the loop back to the start.
  const slideIds = useMemo(() => slides.map((slide) => slide.id).join(','), [slides]);
  const previousIdsRef = useRef(slideIds);

  useEffect(() => {
    if (previousIdsRef.current === slideIds) return;
    previousIdsRef.current = slideIds;
    const ids = slideIds ? slideIds.split(',') : [];
    const stillThere = currentIdRef.current ? ids.indexOf(currentIdRef.current) : -1;
    setIndex(stillThere >= 0 ? stillThere : 0);
  }, [slideIds]);

  const goTo = useCallback(
    (target: number) => {
      if (count === 0) return;
      setIndex(((target % count) + count) % count);
    },
    [count],
  );

  const next = useCallback(() => goTo(currentIndexRef.current + 1), [goTo]);
  const previous = useCallback(() => goTo(currentIndexRef.current - 1), [goTo]);

  // --- automatic advance ----------------------------------------------------
  useEffect(() => {
    window.clearTimeout(advanceTimerRef.current);
    if (suspended || paused || count <= 1 || !current || isSelfTimed(current)) return;

    const durationMs = Math.max(1, current.durationSeconds) * 1000;
    advanceTimerRef.current = window.setTimeout(next, durationMs);
    return () => window.clearTimeout(advanceTimerRef.current);
  }, [current, paused, suspended, count, next]);

  const notifySlideFinished = useCallback(
    (slideId: string) => {
      if (slideId !== currentIdRef.current || paused || suspended) return;
      next();
    },
    [next, paused, suspended],
  );

  // --- interaction ----------------------------------------------------------
  const registerInteraction = useCallback(() => {
    if (suspended) return;
    setControlsVisible(true);
    setPaused(true);

    window.clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(
      () => setControlsVisible(false),
      CONTROLS_VISIBLE_MS,
    );

    window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(
      () => setPaused(false),
      Math.max(5, resumeAfterIdleSeconds) * 1000,
    );
  }, [resumeAfterIdleSeconds, suspended]);

  const togglePaused = useCallback(() => {
    registerInteraction();
    setPaused((value) => !value);
  }, [registerInteraction]);

  const applyDrag = useCallback((px: number, settle: boolean) => {
    const element = dragRef.current;
    if (!element) return;
    element.style.transition = settle ? DRAG_SETTLE : 'none';
    element.style.transform = px === 0 ? '' : `translateX(${px}px)`;
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    draggedRef.current = false;
    // A drag that starts on the nav bar belongs to its chip track, which
    // scrolls sideways itself and must not also change slide.
    const target = event.target as Element | null;
    if (target && typeof target.closest === 'function' && target.closest('.sign-nav')) {
      pointerStartRef.current = null;
      return;
    }
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = pointerStartRef.current;
      if (!start) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;

      if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) {
        draggedRef.current = true;
      }

      // Enough vertical travel and this was never a swipe; let go of it so a
      // stray diagonal drag does not leave the slide sitting off-center.
      if (Math.abs(dy) > SWIPE_MAX_DRIFT_PX) {
        pointerStartRef.current = null;
        applyDrag(0, true);
        return;
      }

      // Only follow the finger while the gesture is mostly sideways, or the
      // slide would wobble left and right as someone scrolls the issue list.
      if (Math.abs(dx) <= Math.abs(dy)) return;

      const damped = Math.sign(dx) * Math.min(Math.abs(dx) * DRAG_FOLLOW, DRAG_MAX_PX);
      applyDrag(damped, false);
    },
    [applyDrag],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const start = pointerStartRef.current;
      pointerStartRef.current = null;
      applyDrag(0, true);

      /*
       * A tap on empty space with the bar already up puts it away again,
       * instead of restarting its ten-second window for as long as someone
       * keeps prodding the screen. Only *empty* space: a tap on the bar itself
       * is someone using it, and a tap on a row is a drill-in, which unmounts
       * the bar anyway.
       */
      const target = event.target as Element | null;
      const onControl =
        target && typeof target.closest === 'function' && target.closest(DISMISS_EXEMPT);
      if (!draggedRef.current && !onControl && controlsVisibleRef.current) {
        window.clearTimeout(controlsTimerRef.current);
        setControlsVisible(false);
        // The pause timer is left alone on purpose: putting the bar away is
        // about the bar, and whoever did it is probably still reading.
        return;
      }

      registerInteraction();
      if (!start) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dy) > SWIPE_MAX_DRIFT_PX) return;
      if (dx <= -SWIPE_THRESHOLD_PX) {
        draggedRef.current = true;
        next();
      } else if (dx >= SWIPE_THRESHOLD_PX) {
        draggedRef.current = true;
        previous();
      }
    },
    [applyDrag, next, previous, registerInteraction],
  );

  const onPointerCancel = useCallback(() => {
    // The browser fires this when it takes a gesture over to scroll the issue
    // list, so whatever happened was a drag rather than a tap.
    draggedRef.current = true;
    pointerStartRef.current = null;
    applyDrag(0, true);
  }, [applyDrag]);

  /**
   * A browser still fires `click` after a drag when press and release share an
   * element, so a swipe across a countdown card or an epic row would change
   * slide *and* drill into whatever it started on, and scrolling the issue list
   * would open the row under your finger. Swallowing that click in the capture
   * phase is what makes both gestures usable on slides that are covered in
   * tappable rows — which is most of them.
   */
  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!draggedRef.current) return;
    draggedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  // Arrow keys and space, for a USB remote or a keyboard during setup.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        registerInteraction();
        next();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        registerInteraction();
        previous();
      } else if (event.key === ' ') {
        event.preventDefault();
        togglePaused();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [next, previous, registerInteraction, togglePaused]);

  useEffect(
    () => () => {
      window.clearTimeout(advanceTimerRef.current);
      window.clearTimeout(resumeTimerRef.current);
      window.clearTimeout(controlsTimerRef.current);
    },
    [],
  );

  return {
    current,
    index,
    count,
    paused,
    controlsVisible,
    next,
    previous,
    goTo,
    togglePaused,
    notifySlideFinished,
    dragRef,
    containerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
  };
}
