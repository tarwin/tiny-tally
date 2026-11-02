<script setup lang="ts">
// The change log: every action that changed the books, newest first, each
// opening to show what it changed. Also the History of one transaction or
// document (?table=…&id=…), and archived history (.tallylog files).
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Banner, Button, Card, CardSection, DatePicker, Icon, Modal, ModalSection, Page, Spinner, toast } from '@octans/ui';
import { api, errorMessage, type Change, type ChangeBatch } from '../lib/api';
import {
  ACTION_WORD,
  TABLES,
  batchLabel,
  batchSummary,
  changedFields,
  dayStartInstant,
  fieldName,
  formatValue,
  formatWhen,
  rowLabel,
} from '../lib/changeLog';
import { addDays, formatDay, today } from '../lib/dates';
import { onBooksChanged } from '../lib/live';
import { session } from '../lib/session';

const route = useRoute();
const router = useRouter();
const books = computed(() => session.books!);
const currency = computed(() => books.value.currency);
const value = (key: string, v: unknown) => formatValue(key, v, currency.value);

const PAGE = 100;

// ---- what's shown ----------------------------------------------------------------
const archive = ref<string | null>(null);
const row = computed(() => {
  const table = route.query.table;
  const id = Number(route.query.id);
  return typeof table === 'string' && Number.isInteger(id) && id > 0 ? { table, id } : null;
});

const batches = ref<ChangeBatch[]>([]);
const total = ref(0);
const oldest = ref<string | null>(null);
const history = ref<Change[]>([]);
const loading = ref(true);

async function load(more = false) {
  loading.value = true;
  try {
    if (row.value) {
      history.value = await api.rowHistory(row.value.table, row.value.id);
    } else {
      const r = await api.changeBatches({ limit: PAGE, offset: more ? batches.value.length : 0, archive: archive.value });
      batches.value = more ? [...batches.value, ...r.rows] : r.rows;
      total.value = r.total;
      oldest.value = r.oldest;
    }
  } catch (e) {
    toast({ title: "Couldn't read the history", content: errorMessage(e), tone: 'error' });
    if (archive.value) archive.value = null;
  } finally {
    loading.value = false;
  }
}
watch([row, archive], () => {
  open.clear();
  void load();
});
onMounted(() => load());
onBooksChanged(() => load());

// ---- opening a batch ----------------------------------------------------------------
const open = reactive(new Map<number, Change[] | null>());

async function toggle(b: ChangeBatch) {
  if (open.has(b.id)) return void open.delete(b.id);
  open.set(b.id, null);
  try {
    open.set(b.id, await api.batchChanges(b.id, archive.value));
  } catch (e) {
    open.delete(b.id);
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

/** Batches by local day, for the date headings. */
const days = computed(() => {
  const out: { day: string; items: ChangeBatch[] }[] = [];
  for (const b of batches.value) {
    const d = new Date(b.at);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(b);
    else out.push({ day, items: [b] });
  }
  return out;
});

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// ---- archive -------------------------------------------------------------------------
const archiving = ref(false);
const archiveBusy = ref(false);
const archiveDate = ref('');

function startArchive() {
  // Up to the lock date by default: that history is frozen anyway.
  archiveDate.value = books.value.lockDate ? addDays(books.value.lockDate, 1) : addDays(today(), -365);
  archiving.value = true;
}

async function doArchive() {
  archiveBusy.value = true;
  try {
    const r = await api.archiveHistory(archiveDate.value, dayStartInstant(archiveDate.value));
    archiving.value = false;
    toast({
      title: `Archived ${r.changes.toLocaleString()} changes`,
      content: r.file.slice(r.file.lastIndexOf('/') + 1),
      tone: 'success',
      actions: [{ label: 'Show', onAction: () => reveal(r.file) }],
    });
    await load();
  } catch (e) {
    toast({ title: "Couldn't archive", content: errorMessage(e), tone: 'error' });
  } finally {
    archiveBusy.value = false;
  }
}

async function openArchive() {
  const path = await tiny.dialog.openFile({ types: ['tallylog'] });
  if (path) archive.value = path;
}

const reveal = (path: string) => void tiny.app.shell.reveal(path);

const archiveName = computed(() => archive.value?.slice(archive.value.lastIndexOf('/') + 1) ?? '');

const subtitle = computed(() => {
  if (row.value) return `Everything that changed on this ${(TABLES[row.value.table] ?? 'item').toLowerCase()}.`;
  if (archive.value) return `Archived history: ${archiveName.value}`;
  return 'Every change to the books, newest first. Open one to see exactly what changed.';
});

</script>

<template>
  <Page
    :title="row ? 'History' : 'Activity'"
    :subtitle="subtitle"
    size="wide"
    :breadcrumbs="row ? [{ label: 'Activity', onAction: () => router.push('/activity') }] : undefined"
    :primary-action="row || archive ? undefined : { label: 'Archive older history…', icon: 'mdi:archive-arrow-down-outline', onAction: startArchive }"
    :secondary-actions="
      row
        ? []
        : archive
          ? [{ label: 'Back to these books', icon: 'mdi:arrow-left', onAction: () => (archive = null) }]
          : [{ label: 'Open archive…', icon: 'mdi:folder-open-outline', onAction: openArchive }]
    "
  >
    <Banner v-if="archive" status="info" title="Viewing an archive">
      This is history moved out of {{ books.name }} earlier. It can be read here but not changed.
    </Banner>

    <div v-if="loading && !batches.length && !history.length" class="Loading"><Spinner /></div>

    <!-- one row's history -->
    <Card v-else-if="row">
      <CardSection>
        <p v-if="!history.length" class="subdued Empty">No changes recorded yet. History starts from when this version of Tiny Tally first opened the file.</p>
        <ol class="Changes">
          <li v-for="c in history" :key="c.id">
            <div class="Change__head">
              <span class="Change__what">{{ ACTION_WORD[c.action] }} {{ rowLabel(c, currency) }}</span>
              <span class="subdued Small">{{ formatWhen(c.at) }}{{ c.host ? ` · ${c.host}` : '' }}</span>
            </div>
            <ul class="Fields">
              <li v-for="f in changedFields(c)" :key="f.key">
                <span class="Fields__name">{{ fieldName(f.key) }}</span>
                <template v-if="c.action === 'update'">
                  <span class="Fields__old">{{ value(f.key, f.before) }}</span> → <span>{{ value(f.key, f.after) }}</span>
                </template>
                <span v-else>{{ value(f.key, c.action === 'delete' ? f.before : f.after) }}</span>
              </li>
            </ul>
          </li>
        </ol>
      </CardSection>
    </Card>

    <!-- the whole log -->
    <template v-else>
      <Card v-if="!batches.length">
        <CardSection>
          <p class="subdued Empty">
            Nothing recorded yet. From now on, every change to the books shows up here.
          </p>
        </CardSection>
      </Card>

      <section v-for="d in days" :key="d.day" class="Day">
        <h3 class="Day__title">{{ formatDay(d.day) }}</h3>
        <Card>
          <div v-for="b in d.items" :key="b.id" class="Batch">
            <button type="button" class="Batch__row" :aria-expanded="open.has(b.id)" @click="b.action === 'history.archive' ? undefined : toggle(b)">
              <Icon :icon="b.action === 'history.archive' ? 'mdi:archive-outline' : open.has(b.id) ? 'mdi:chevron-down' : 'mdi:chevron-right'" class="Batch__icon" />
              <span class="Batch__time money">{{ time(b.at) }}</span>
              <span class="Batch__label">
                {{ batchLabel(b) }}
                <template v-if="b.action === 'history.archive' && batchSummary(b)">
                  <span class="subdued">
                    · {{ Number(batchSummary(b)!.changes).toLocaleString() }} changes before
                    {{ formatDay(batchSummary(b)!.before) }}
                  </span>
                </template>
              </span>
              <span class="subdued Small Batch__meta">
                <template v-if="b.action !== 'history.archive' && b.count">{{ b.count }} change{{ b.count === 1 ? '' : 's' }}</template>
                <template v-if="b.host"> · {{ b.host }}</template>
              </span>
            </button>
            <div v-if="b.action === 'history.archive' && batchSummary(b)" class="Batch__body Small">
              <span class="subdued">{{ batchSummary(b)!.file }}</span>
              <Button type="plain" size="small" icon="mdi:folder-search-outline" @click="reveal(batchSummary(b)!.file)">Show</Button>
              <Button type="plain" size="small" icon="mdi:folder-open-outline" @click="archive = batchSummary(b)!.file">Open</Button>
              <div class="subdued Hash">SHA-256 {{ batchSummary(b)!.sha256 }}</div>
            </div>
            <div v-else-if="open.has(b.id)" class="Batch__body">
              <Spinner v-if="!open.get(b.id)" size="small" />
              <ol v-else class="Changes">
                <li v-for="c in open.get(b.id)" :key="c.id">
                  <div class="Change__head">
                    <span class="Change__what">{{ ACTION_WORD[c.action] }} {{ rowLabel(c, currency) }}</span>
                    <Button
                      v-if="!archive && (c.tableName === 'entries' || c.tableName === 'invoices' || c.tableName === 'journals') && c.rowId"
                      type="plain"
                      size="small"
                      @click="router.push({ path: '/activity', query: { table: c.tableName, id: c.rowId } })"
                    >
                      History
                    </Button>
                  </div>
                  <ul class="Fields">
                    <li v-for="f in changedFields(c)" :key="f.key">
                      <span class="Fields__name">{{ fieldName(f.key) }}</span>
                      <template v-if="c.action === 'update'">
                        <span class="Fields__old">{{ value(f.key, f.before) }}</span> → <span>{{ value(f.key, f.after) }}</span>
                      </template>
                      <span v-else>{{ value(f.key, c.action === 'delete' ? f.before : f.after) }}</span>
                    </li>
                  </ul>
                </li>
              </ol>
            </div>
          </div>
        </Card>
      </section>

      <div v-if="batches.length < total" class="More">
        <Button :loading="loading" @click="load(true)">Show older</Button>
      </div>
      <p v-else-if="oldest && !archive" class="subdued Small More">History goes back to {{ formatWhen(oldest) }}.</p>
    </template>

    <Modal
      :visible="archiving"
      title="Archive older history"
      :loading="archiveBusy"
      :primary-action="{ label: 'Archive', onAction: doArchive }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (archiving = false) }]"
      overflow-visible
      @close="archiving = false"
    >
      <ModalSection>
        <p class="Lead">
          Moves the history from before this date into a separate file next to your books, then shrinks the books
          file. Your transactions and documents don't change, only the record of how they got that way.
        </p>
        <DatePicker v-model="archiveDate" type="date" model-format="YYYY-MM-DD" label="Archive history before" :max="today()" />
        <p class="subdued Small">
          {{ books.lockDate ? `Suggested: the day after your books were locked (${formatDay(books.lockDate)}).` : 'Suggested: a year ago.' }}
          The archive opens from this page with Open archive…. Keep it with your backups.
        </p>
      </ModalSection>
    </Modal>
  </Page>
</template>

<style scoped>
.Loading {
  display: grid;
  place-items: center;
  padding: 40px;
}

.Empty {
  margin: 0;
}

.Day {
  margin-bottom: 18px;
}

.Day__title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--octans-text-subdued);
}

.Batch + .Batch {
  border-top: 1px solid var(--octans-border);
}

.Batch__row {
  font: inherit;
  color: var(--octans-text);
  background: none;
  border: 0;
  width: 100%;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--tt-cell-y) var(--tt-cell-x);
  cursor: pointer;
}

.Batch__row:hover {
  background: var(--octans-surface-hover);
}

.Batch__icon {
  flex: none;
  color: var(--octans-text-subdued);
}

.Batch__time {
  flex: none;
  width: 70px;
  color: var(--octans-text-subdued);
}

.Batch__label {
  flex: 1;
  min-width: 0;
}

.Batch__meta {
  flex: none;
}

.Batch__body {
  padding: 4px var(--tt-cell-x) 12px 46px;
}

.Changes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.Change__head {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: space-between;
}

.Change__what {
  font-weight: 600;
}

.Fields {
  list-style: none;
  margin: 2px 0 0;
  padding: 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.Fields__name {
  display: inline-block;
  min-width: 130px;
  color: var(--octans-text-subdued);
}

.Fields__old {
  color: var(--octans-text-subdued);
  text-decoration: line-through;
}

.Small {
  font-size: 12px;
}

.Hash {
  font-family: var(--octans-font-mono);
  font-size: 11px;
  margin-top: 4px;
  word-break: break-all;
}

.More {
  display: flex;
  justify-content: center;
  margin: 12px 0;
}

.Lead {
  margin: 0 0 14px;
}
</style>
