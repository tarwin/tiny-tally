import { reactive } from 'vue';
import type { Books, RecentBooks } from './api';
import { countryProfile } from '../shared/countries';

export const session = reactive({
  ready: false,
  books: null as Books | null,
  recent: [] as RecentBooks[],
  internalDir: '',
});

/** The open books' country profile, and its tax (null when off or unsupported). */
export const booksProfile = () => countryProfile(session.books?.country);
export const booksTax = () => (session.books?.taxEnabled ? booksProfile().tax : null);

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
