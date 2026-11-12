import { useCallback, useEffect, useState } from 'react';
import { formatClock } from '../lib/format';
import { useNow } from '../lib/useNow';
import type { DrillTarget } from '../../../plugins/web/sign';
import { DrillOverlay } from './drill/DrillOverlay';
import { SlideNav } from './SlideNav';
import { prefetchSlide, SlideRenderer } from './slides';
import { usePlaylist } from './usePlaylist';
import { useSlideshow } from './useSlideshow';

export function App() {
  const { playlist, loading, offline, clockOffsetMs } = usePlaylist();
  const settings = playlist?.settings;

  // The drill-in stack. Empty means the slideshow is running normally; any
  // entry means someone is reading a detail view and the loop is on hold.
  const [stack, setStack] = useState<DrillTarget[]>([]);
  const drilled = stack.length > 0;

  // The blackout schedule, and nothing over the top of it. There is no touch
  // override on purpose: the schedule is the only thing that decides, so a
  // screen someone prodded on their way past cannot be left lit all evening.
  const asleep = playlist?.sleep?.asleep ?? false;

  const show = useSlideshow(
    playlist?.slides ?? [],
    settings?.resumeAfterIdleSeconds ?? 45,
    // Asleep suspends the loop as firmly as a drill-in does. A slideshow
    // advancing behind a black screen wakes to a slide chosen by however long
    // the office was empty, and burns a player's evening on timers.
    drilled || asleep,
  );
  const now = useNow(10_000, clockOffsetMs);

  const push = useCallback((target: DrillTarget) => setStack((current) => [...current, target]), []);
  const back = useCallback(
    () => setStack((current) => current.slice(0, -1)),
    [],
  );
  const close = useCallback(() => setStack([]), []);

  // The slide decides, not the screen. Between slides — connecting, or nothing
  // to show — there is no slide to ask, and dark is the quieter thing to leave
  // glowing on a wall overnight.
  const theme = show.current?.theme ?? 'dark';

  /*
   * Warm the slides that fetch payloads of their own, so they arrive with
   * their data rather than a loading placeholder.
   *
   * Everything on arrival, so the first lap is already warm, and then whatever
   * is next as the loop moves — by the time a slide comes round again its data
   * is minutes old, which is exactly when it wants refreshing. Warming is
   * cheap to repeat: each plugin skips a fetch it does not need.
   */
  const slides = playlist?.slides;
  useEffect(() => {
    // Nothing is on screen to be stale, so a sleeping sign does not poll Jira
    // all night. It warms on the way back up, which is the effect below firing
    // once `asleep` clears.
    if (!slides || asleep) return;
    for (const slide of slides) prefetchSlide(slide);
  }, [slides, asleep]);

  const nextSlide = slides?.length ? slides[(show.index + 1) % slides.length] : undefined;
  useEffect(() => {
    if (nextSlide && !asleep) prefetchSlide(nextSlide);
  }, [nextSlide, asleep]);

  /*
   * Scheduled dark, and the only place this codebase blanks a sign on purpose.
   *
   * Nothing is drawn and nothing is listening. A wall panel is dark for
   * fourteen hours at a stretch, so anything lit for that long is a burn-in
   * risk — the same reason the nav bar hides itself — and there is no touch
   * handler because the schedule is the only thing allowed to end this.
   *
   * Ahead of the loading and empty branches on purpose: a screen whose server
   * has just come back, or which has no playlist at all, should still be dark
   * at four in the morning rather than showing a placeholder to an empty room.
   */
  if (asleep) {
    return <div className="sign sign--dark sign--asleep" role="presentation" />;
  }

  if (loading) {
    return (
      <div className={`sign sign--${theme} sign--message`}>
        <p className="sign__message">Connecting to the sign server…</p>
      </div>
    );
  }

  if (!playlist || show.count === 0) {
    return (
      <div className={`sign sign--${theme} sign--message`}>
        <div className="sign__message">
          <h1>Nothing to show yet</h1>
          <p>
            Add slides in the control panel, at the root of this address.
          </p>
        </div>
        {offline ? <span className="sign__offline" title="Server unreachable" /> : null}
      </div>
    );
  }

  const current = show.current;
  const transition = settings?.transition ?? 'fade';
  const transitionMs = settings?.transitionMs ?? 600;
  const showProgress = show.count > 1 && current && !drilled;
  const navigating = show.controlsVisible && !drilled && show.count > 1;

  return (
    <div
      className={`sign sign--${theme} ${drilled ? 'is-drilled' : ''} ${
        navigating ? 'is-navigating' : ''
      }`}
      // Swipe and wake-tap only apply to the slideshow itself; the overlay
      // stops propagation so a drag inside a list cannot change slide.
      {...(drilled ? {} : show.containerProps)}
      role="presentation"
    >
      {/* Separate from the stage so the drag transform never fights the
          entry animation, which also animates transform and holds its end
          value with `animation-fill-mode: both`. */}
      <div className="sign__drag" ref={show.dragRef}>
        {current ? (
          <div
            key={current.id}
            className={`sign__stage sign__stage--${transition}`}
            style={{ animationDuration: `${transitionMs}ms` }}
          >
            <SlideRenderer
              slide={current}
              media={playlist.media}
              data={playlist.plugins}
              clockOffsetMs={clockOffsetMs}
              onFinished={show.notifySlideFinished}
              onDrill={push}
            />
          </div>
        ) : null}
      </div>

      {settings?.signName ? <div className="sign__name">{settings.signName}</div> : null}
      {settings?.showClock ? <div className="sign__clock">{formatClock(now)}</div> : null}
      {offline ? <span className="sign__offline" title="Server unreachable" /> : null}

      {showProgress ? (
        <div
          key={`${current.id}-progress`}
          className="sign__progress"
          style={{
            animationDuration: `${current.durationSeconds}s`,
            animationPlayState: show.paused ? 'paused' : 'running',
          }}
        />
      ) : null}

      {!drilled ? (
        <SlideNav
          slides={playlist.slides}
          index={show.index}
          visible={show.controlsVisible}
          paused={show.paused}
          onGoTo={show.goTo}
          onPrevious={show.previous}
          onNext={show.next}
          onTogglePaused={show.togglePaused}
        />
      ) : null}

      {drilled ? (
        <DrillOverlay
          stack={stack}
          onBack={back}
          onClose={close}
          onPush={push}
          clockOffsetMs={clockOffsetMs}
          idleSeconds={settings?.resumeAfterIdleSeconds ?? 45}
        />
      ) : null}
    </div>
  );
}
