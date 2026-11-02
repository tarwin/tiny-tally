// Module hooks so Node can load the tinyjs backend: tjs:sqlite becomes an
// adapter over node:sqlite, and extensionless relative imports get '.ts'.
// (load, below: .vue pages for the router.)
const SQLITE = new URL('./sqlite.ts', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'tjs:sqlite') return { url: SQLITE, shortCircuit: true };
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await next(specifier + '.ts', context);
    } catch {
      // not a .ts file; let Node report it
    }
  }
  return next(specifier, context);
}

// Pages aren't rendered in tests: a .vue file the router loads is an empty component.
export async function load(url, context, next) {
  if (url.endsWith('.vue')) return { format: 'module', source: 'export default {};', shortCircuit: true };
  return next(url, context);
}
