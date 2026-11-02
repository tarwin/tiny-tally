// A stand-in for the tinyjs app object the backend talks to, recording what
// it pushes to each window.
import { init } from '../../backend/main.ts';

export type Push = { win: string; event: string; data: any };

export function fakeApp() {
  const pushes: Push[] = [];
  const handle = (win: string) => ({
    push: (event: string, data: unknown) => void pushes.push({ win, event, data }),
    setTitle: () => {},
    show: () => {},
    setHideOnClose: () => {},
  });
  const store = new Map<string, unknown>();
  init({
    win: handle('main'),
    window: handle,
    push: () => {},
    store: { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: unknown) => void store.set(k, v) },
  } as any);
  return pushes;
}
