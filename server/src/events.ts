export type SignEvent =
  | { type: 'content-changed' }
  | { type: 'reload' }
  | { type: 'ping' };

type Listener = (event: SignEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Tells every connected sign that something it renders has changed. Called
 * after any mutating request so a display updates without waiting on a poll.
 */
export function broadcast(event: SignEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A dead connection must not take down the others.
    }
  }
}

export function listenerCount(): number {
  return listeners.size;
}
