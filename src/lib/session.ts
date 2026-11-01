import { reactive } from 'vue';
import type { Books, RecentBooks } from './api';

export const session = reactive({
  ready: false,
  books: null as Books | null,
  recent: [] as RecentBooks[],
  internalDir: '',
});

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
