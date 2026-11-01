// Module hooks so Node can load the tinyjs backend: tjs:sqlite becomes an
// adapter over node:sqlite, and extensionless relative imports get '.ts'.
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
