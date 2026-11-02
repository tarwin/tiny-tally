// Back and forward for the top bar: each tab keeps its own history (tabs.ts).
// Kept there rather than read from the browser's history, which can't say
// whether forward is possible and would step back into another tab.
export { canGoBack, canGoForward, goBack, goForward } from './tabs';
