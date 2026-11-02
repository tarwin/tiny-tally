// Until 0.6.2 the app id was com.tarwin.tiny-tally; now it's
// art.tarwin.tiny-tally, like the other tinyjs apps (Shelf only installs
// those). tinyjs names the data folder after the id, so the first run under
// the new one moves the old folder's contents across: books stored
// internally, and the settings in store.json, whose paths into the old
// folder are pointed at the new one.
//
// The settings go in through app.store rather than as a file: the page may
// already have read the store (an empty one) by now, and the store keeps
// what it read in memory. The old folder is renamed "<id>.moved" once done,
// so this runs once, and nothing in it is ever deleted.
const OLD_ID = 'com.tarwin.tiny-tally';

const exists = (path: string) =>
  tjs.stat(path).then(
    () => true,
    () => false,
  );

export async function moveOldData(app: TinyApp) {
  const dir = (await app.paths()).data;
  const id = dir.slice(dir.search(/[^/\\]+$/));
  if (id === OLD_ID) return;
  const old = dir.slice(0, -id.length) + OLD_ID;
  if (!(await exists(old))) return;

  let store: Record<string, unknown> = {};
  try {
    // Every path into the old folder now points into the new one.
    const quoted = (s: string) => JSON.stringify(s).slice(1, -1);
    const text = new TextDecoder().decode(await tjs.readFile(`${old}/store.json`));
    store = JSON.parse(text.split(quoted(old + '/')).join(quoted(dir + '/')));
  } catch {
    // No settings saved, or unreadable: there's still the books to move.
  }

  for await (const e of await tjs.readDir(old)) {
    if (e.name === 'store.json' || (await exists(`${dir}/${e.name}`))) continue;
    await tjs.rename(`${old}/${e.name}`, `${dir}/${e.name}`).catch((err: unknown) => console.error(`Moving ${e.name}:`, err));
  }
  for (const [key, value] of Object.entries(store)) await app.store.set(key, value);
  await tjs.rename(old, `${old}.moved`).catch((err: unknown) => console.error('Moving the old data folder aside:', err));
}
