import { reactive, watchEffect } from 'vue';
import type { Books, RecentBooks } from './api';
import { countryProfile } from '../shared/countries';
import { moneyDisplay } from './money';

export const session = reactive({
  ready: false,
  books: null as Books | null,
  recent: [] as RecentBooks[],
  internalDir: '',
});

watchEffect(() => (moneyDisplay.screen = session.books?.currencyDisplay ?? 'narrow'));

/** The open books' country profile, and its tax (null when off or unsupported). */
export const booksProfile = () => countryProfile(session.books?.country);
export const booksTax = () => (session.books?.taxEnabled ? booksProfile().tax : null);

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
