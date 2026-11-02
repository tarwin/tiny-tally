// Transactions for a scrolling table: the first batch, then more as the
// table asks (DataTable's load-more), instead of pages.
import { computed, ref } from 'vue';
import { api, type EntryList, type EntryQuery } from './api';

const BATCH = 100;
/** The most entries.list returns at once (backend/entries.ts). */
const MOST = 1000;

export function useEntryFeed(query: () => EntryQuery) {
  const list = ref<EntryList>({ rows: [], total: 0, inflow: 0, outflow: 0 });
  const loading = ref(true);
  const loadingMore = ref(false);
  const hasMore = computed(() => list.value.rows.length < list.value.total);
  let seq = 0;

  /**
   * From the top. `keep` reloads as many rows as are showing (the books
   * changed), so the table doesn't jump back to the first batch.
   */
  async function reload(keep = false) {
    const mine = ++seq;
    loading.value = true;
    const limit = keep ? Math.min(Math.max(list.value.rows.length, BATCH), MOST) : BATCH;
    try {
      const result = await api.listEntries({ ...query(), limit, offset: 0 });
      if (mine === seq) list.value = result;
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  async function loadMore() {
    if (loadingMore.value || !hasMore.value) return;
    const mine = seq;
    loadingMore.value = true;
    try {
      const result = await api.listEntries({ ...query(), limit: BATCH, offset: list.value.rows.length });
      // A reload since (new filters) makes these rows stale.
      if (mine === seq) list.value = { ...result, rows: [...list.value.rows, ...result.rows] };
    } finally {
      loadingMore.value = false;
    }
  }

  return { list, loading, loadingMore, hasMore, reload, loadMore };
}
