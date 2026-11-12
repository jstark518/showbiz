import { useEffect, useState } from 'react';

/**
 * A ticking clock, corrected by the server's offset so a player whose system
 * time has drifted still counts down to the right moment.
 */
export function useNow(intervalMs = 1000, offsetMs = 0): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);

  useEffect(() => {
    setNow(Date.now() + offsetMs);
    const timer = window.setInterval(() => setNow(Date.now() + offsetMs), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, offsetMs]);

  return now;
}
