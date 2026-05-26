import { useState, useEffect } from "react";

export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();

  function setState(next: Partial<T>) {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  }

  function getState(): T {
    return state;
  }

  function useStore(): T {
    const [, tick] = useState(0);
    useEffect(() => {
      const rerender = () => tick((n) => n + 1);
      listeners.add(rerender);
      return () => { listeners.delete(rerender); };
    }, []);
    return state;
  }

  return { setState, getState, useStore };
}
