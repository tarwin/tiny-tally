<script setup lang="ts">
import { Banner, Button } from '@octans/ui';
import { installUpdate, update } from '../lib/updates';
</script>

<template>
  <div v-if="update.latest && !update.dismissed" class="UpdateBanner">
    <Banner status="info" :title="`Tiny Tally ${update.latest} is ready`">
      <p v-if="update.notes" class="Notes">{{ update.notes }}</p>
      <p v-else>Restart to start using the new version. Your books are saved as you go.</p>
      <div class="Actions">
        <Button type="primary" :loading="update.installing" @click="installUpdate">Restart and update</Button>
        <Button type="plain" :disabled="update.installing" @click="update.dismissed = true">Later</Button>
      </div>
    </Banner>
  </div>
</template>

<style scoped>
.UpdateBanner {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 50;
  width: min(420px, calc(100vw - 32px));
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  border-radius: 12px;
}

.UpdateBanner p {
  margin: 0 0 10px;
}

/* Release notes are markdown-ish text: keep their lines, cap the height. */
.Notes {
  white-space: pre-line;
  max-height: 180px;
  overflow: auto;
}

.Actions {
  display: flex;
  gap: 8px;
}
</style>
