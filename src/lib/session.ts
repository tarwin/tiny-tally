import { reactive } from 'vue';
import type { Company, RecentCompany } from './api';

export const session = reactive({
  ready: false,
  company: null as Company | null,
  recent: [] as RecentCompany[],
  internalDir: '',
});

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
