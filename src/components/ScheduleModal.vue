<script setup lang="ts">
// "Make recurring": turns a transaction, invoice or bill into a schedule.
// The caller passes what to repeat (payload); this asks how often.
import { computed, ref, watch } from 'vue';
import { DatePicker, FormLayout, FormLayoutGroup, Modal, ModalSection, Select, TextField, ToggleSwitch, toast } from '@octans/ui';
import { api, errorMessage, type Frequency, type Schedule, type ScheduleKind } from '../lib/api';
import { FREQUENCY_OPTIONS, nextOccurrence } from '../lib/schedule';

const props = defineProps<{
  visible: boolean;
  kind: ScheduleKind;
  payload: any;
  name: string;
  /** The date of the thing being repeated; the schedule starts one period later. */
  from: string;
  /** Edit an existing schedule instead. */
  schedule?: Schedule | null;
}>();
const emit = defineEmits<{ close: []; saved: [id: number] }>();

const form = ref({ name: '', frequency: 'monthly' as Frequency, startDate: '', endDate: '' as string | undefined, autoApprove: false, active: true });
const saving = ref(false);
const error = ref<string | null>(null);

watch(
  () => props.visible,
  (v) => {
    if (!v) return;
    error.value = null;
    touched.value = false;
    const s = props.schedule;
    form.value = s
      ? { name: s.name, frequency: s.frequency, startDate: s.nextDate, endDate: s.endDate ?? undefined, autoApprove: s.autoApprove, active: s.active }
      : { name: props.name, frequency: 'monthly', startDate: nextOccurrence(props.from, 'monthly'), endDate: undefined, autoApprove: false, active: true };
  },
);

// Until the user picks a date, the first one follows the frequency.
const touched = ref(false);
watch(
  () => form.value.frequency,
  (f) => {
    if (!props.schedule && !touched.value) form.value.startDate = nextOccurrence(props.from, f);
  },
);

const noun = computed(() => (props.kind === 'entry' ? 'transaction' : props.kind));

async function save() {
  saving.value = true;
  error.value = null;
  try {
    const s = props.schedule;
    const id = await api.saveSchedule({
      id: s?.id,
      kind: s?.kind ?? props.kind,
      name: form.value.name,
      payload: s?.payload ?? props.payload,
      frequency: form.value.frequency,
      // Editing keeps the original anchor unless the dates were changed.
      startDate: s && form.value.startDate === s.nextDate && form.value.frequency === s.frequency ? s.startDate : form.value.startDate,
      endDate: form.value.endDate || null,
      autoApprove: form.value.autoApprove,
      active: form.value.active,
    });
    toast({ title: s ? 'Schedule saved' : `Repeating ${form.value.frequency}`, tone: 'success' });
    emit('saved', id);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal
    :visible="visible"
    :title="schedule ? 'Edit schedule' : `Repeat this ${noun}`"
    :loading="saving"
    :primary-action="{ label: schedule ? 'Save' : 'Make recurring', onAction: save }"
    :secondary-actions="[{ label: 'Cancel', onAction: () => emit('close') }]"
    overflow-visible
    @close="emit('close')"
  >
    <ModalSection>
      <FormLayout>
        <TextField v-model="form.name" label="Name" :error="error" />
        <FormLayoutGroup>
          <Select v-model="form.frequency" label="Repeats" :options="FREQUENCY_OPTIONS" />
          <DatePicker
            v-model="form.startDate"
            type="date"
            model-format="YYYY-MM-DD"
            :label="schedule ? 'Next one' : 'First one'"
            @update:model-value="touched = true"
          />
        </FormLayoutGroup>
        <DatePicker v-model="form.endDate" type="date" model-format="YYYY-MM-DD" label="Stop after (optional)" />
        <ToggleSwitch
          v-if="(schedule?.kind ?? kind) !== 'entry'"
          v-model="form.autoApprove"
          :label="(schedule?.kind ?? kind) === 'bill' ? 'Approve each bill automatically' : 'Approve each invoice automatically'"
          help-text="Off: each one waits as a draft for you to check and send."
        />
        <ToggleSwitch v-if="schedule" v-model="form.active" label="Active" />
        <p class="subdued Note">
          Due {{ noun }}s are created when you open the company, so nothing is missed if the app was closed.
        </p>
      </FormLayout>
    </ModalSection>
  </Modal>
</template>

<style scoped>
.Note {
  font-size: 12px;
  margin: 0;
}
</style>
