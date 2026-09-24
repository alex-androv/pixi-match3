import { useSyncExternalStore } from 'react';

/**
 * Minimal external store. The game (outside React) writes to it,
 * React components subscribe through useSyncExternalStore and re-render only
 * when the selected slice of state changes.
 */
export class Store<T extends object> {
  private listeners = new Set<() => void>();

  constructor(private state: T) {}

  get = (): T => this.state;

  set(patch: Partial<T>): void {
    let changed = false;
    for (const key in patch) {
      if (!Object.is(this.state[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export function useStore<T extends object, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
