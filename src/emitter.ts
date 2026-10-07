// Small typed event emitter.

export type Unsubscribe = () => void;

export interface Emitter<E> {
  on<K extends keyof E>(type: K, fn: (value: E[K]) => void): Unsubscribe;
  emit<K extends keyof E>(type: K, value: E[K]): void;
}

export function createEmitter<E>(): Emitter<E> {
  const listeners = new Map<keyof E, Set<(value: any) => void>>();
  return {
    on(type, fn) {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(type, value) {
      listeners.get(type)?.forEach((fn) => fn(value));
    },
  };
}
