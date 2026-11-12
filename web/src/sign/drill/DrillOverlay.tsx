import { useEffect, useState } from 'react';
import { DRILL_VIEWS, type DrillPush, type DrillTarget } from '../../../../plugins/web/sign';

interface Props {
  stack: DrillTarget[];
  onBack: () => void;
  onClose: () => void;
  onPush: DrillPush;
  clockOffsetMs: number;
  /** Seconds of no touch before the overlay closes itself and the loop resumes. */
  idleSeconds: number;
}

/**
 * The drill-in stack: tapping something on a slide pushes a level, back pops
 * one, and an idle timeout unwinds the lot.
 *
 * The overlay itself is the chrome and nothing else. What a level *contains*
 * belongs to the plugin whose slide pushed it — see `DrillView` in
 * `plugins/web/types.tsx`.
 */
export function DrillOverlay({ stack, onBack, onClose, onPush, clockOffsetMs, idleSeconds }: Props) {
  const target = stack[stack.length - 1];
  const [secondsLeft, setSecondsLeft] = useState(idleSeconds);

  // Any touch inside the overlay restarts the countdown; when it runs out the
  // sign returns to the loop by itself. A wall panel has no one to close it.
  useEffect(() => {
    setSecondsLeft(idleSeconds);
  }, [stack.length, idleSeconds]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          onClose();
          return idleSeconds;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [onClose, idleSeconds]);

  if (!target) return null;

  const view = DRILL_VIEWS[target.kind];

  return (
    <div
      className="drill"
      onPointerDown={() => setSecondsLeft(idleSeconds)}
      onWheel={() => setSecondsLeft(idleSeconds)}
    >
      <header className="drill__bar">
        <button type="button" className="drill__back" onClick={onBack}>
          ‹ Back
        </button>
        <nav className="drill__crumbs">
          {stack.map((entry, index) => (
            <span key={index} className="drill__crumb">
              {index > 0 ? <span className="drill__sep">›</span> : null}
              {drillTitle(entry)}
            </span>
          ))}
        </nav>
        <div className="drill__right">
          <span className="drill__timer" title="Returns to the slideshow">
            {secondsLeft}s
          </span>
          <button type="button" className="drill__close" onClick={onClose}>
            ✕
          </button>
        </div>
      </header>

      <div className="drill__body">
        {view ? (
          view.render(target, { onPush, clockOffsetMs })
        ) : (
          // Only reachable if a plugin is removed while a sign is running, or
          // a player is older than the panel. Better than a blank overlay
          // nobody can back out of.
          <p className="drill__message">This screen cannot show that.</p>
        )}
      </div>
    </div>
  );
}

function drillTitle(target: DrillTarget): string {
  return DRILL_VIEWS[target.kind]?.title(target) ?? '';
}
