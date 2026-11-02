// Just enough of a browser window and the tinyjs page API for the router and
// the tab and live-update modules to run under Node. Import before them.

type Listener = (e: any) => void;
const listeners = new Map<string, Listener[]>();
const on = (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]);

const location = { protocol: 'file:', host: '', pathname: '/index.html', search: '', hash: '', href: '' };
let state: unknown = null;
function setUrl(url: string) {
  location.hash = url.slice(url.indexOf('#'));
}
const history = {
  get state() {
    return state;
  },
  get length() {
    return 1;
  },
  pushState(s: unknown, _t: string, url: string) {
    state = s;
    setUrl(url);
  },
  replaceState(s: unknown, _t: string, url: string) {
    state = s;
    setUrl(url);
  },
  go() {},
};

Object.assign(globalThis, {
  window: { location, history, addEventListener: on, removeEventListener() {}, scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0 },
  location,
  history,
  document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({ content: {}, style: {}, setAttribute() {} }) },
});

/** Sends a page event to what the modules listen for (capture listeners on window). */
export function dispatch(type: string, e: Record<string, unknown>) {
  const ev = { metaKey: false, ctrlKey: false, shiftKey: false, button: 0, preventDefault() {}, stopPropagation() {}, ...e };
  for (const fn of listeners.get(type) ?? []) fn(ev);
  return ev;
}

/** An element that is (or sits inside) a link to `href`, or isn't in one. */
export const element = (href: string | null) => ({
  closest: (sel: string) => (href && sel.startsWith('a[') ? { getAttribute: () => href } : null),
});

export const calls: { method: string; params: unknown }[] = [];
export const store = new Map<string, unknown>();

(globalThis as any).tiny = {
  system: { isMacOS: () => true, isWindows: () => false },
  api: {
    call: async (method: string, params: unknown) => {
      calls.push({ method, params });
      return true;
    },
  },
  store: { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: unknown) => void store.set(k, v) },
};
