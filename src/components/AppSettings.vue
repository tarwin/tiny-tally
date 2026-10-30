<script setup lang="ts">
// App settings: how Tiny Tally looks and starts, for every company. Company
// details (tax, numbering, the file) are on the Settings page instead.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Modal, ModalSection, SegmentedControl, ToggleSwitch, type ThemePreferenceType } from '@octans/ui';
import { DENSITY_OPTIONS, ZOOM_OPTIONS, appSettings, appSettingsPanel, updateAppSettings, type Density } from '../lib/appSettings';
import { session } from '../lib/session';
import { THEME_OPTIONS, applyTheme, themePreference } from '../lib/theme';

const props = defineProps<{ navMin: boolean }>();
const emit = defineEmits<{ 'update:navMin': [value: boolean] }>();

const router = useRouter();
const density = computed(() => DENSITY_OPTIONS.find((o) => o.value === appSettings.density)!);

function close() {
  appSettingsPanel.visible = false;
}

function companySettings() {
  close();
  void router.push('/settings');
}
</script>

<template>
  <Modal :visible="appSettingsPanel.visible" title="App settings" :dialog-style="{ width: '520px' }" @close="close">
    <ModalSection>
      <div class="Prefs">
        <section>
          <h3>Theme</h3>
          <SegmentedControl
            :model-value="themePreference"
            :options="THEME_OPTIONS"
            full-width
            @update:model-value="(v: string) => applyTheme(v as ThemePreferenceType)"
          />
        </section>

        <section>
          <h3>Density</h3>
          <SegmentedControl
            :model-value="appSettings.density"
            :options="DENSITY_OPTIONS.map(({ label, value, icon }) => ({ label, value, icon }))"
            full-width
            @update:model-value="(v: string) => updateAppSettings({ density: v as Density })"
          />
          <p class="subdued Hint">{{ density.help }}</p>
          <div class="Sample" aria-hidden="true">
            <div v-for="n in 3" :key="n" class="Sample__row">
              <span class="Sample__date" />
              <span class="Sample__text" :style="{ width: `${70 - n * 12}%` }" />
              <span class="Sample__amount" />
            </div>
          </div>
        </section>

        <section>
          <h3>Size</h3>
          <SegmentedControl
            :model-value="appSettings.zoom"
            :options="ZOOM_OPTIONS"
            full-width
            @update:model-value="(v: number) => updateAppSettings({ zoom: v })"
          />
          <p class="subdued Hint">Makes text and everything else bigger or smaller.</p>
        </section>

        <section class="Toggles">
          <ToggleSwitch :model-value="props.navMin" label="Collapse the sidebar to icons" @update:model-value="(v: boolean) => emit('update:navMin', v)" />
          <ToggleSwitch
            :model-value="appSettings.reopenLast"
            label="Open the last company when Tiny Tally starts"
            @update:model-value="(v: boolean) => updateAppSettings({ reopenLast: v })"
          />
        </section>

        <p v-if="session.company" class="subdued Hint">
          Tax, numbering and business details belong to each company:
          <Button type="plain" size="small" @click="companySettings">Company settings</Button>
        </p>
      </div>
    </ModalSection>
  </Modal>
</template>

<style scoped>
.Prefs {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
}

.Hint {
  margin: 6px 0 0;
  font-size: 12px;
}

.Toggles {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* A few fake table rows that follow the density, so the choice is visible here. */
.Sample {
  margin-top: 10px;
  border: 1px solid var(--octans-border);
  border-radius: 8px;
  overflow: hidden;
}

.Sample__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: var(--tt-cell-y) var(--tt-cell-x);
  border-bottom: 1px solid var(--octans-border);
}

.Sample__row:last-child {
  border-bottom: 0;
}

.Sample__row > span {
  height: 8px;
  border-radius: 4px;
  background: var(--octans-border);
}

.Sample__date {
  width: 48px;
}

.Sample__text {
  flex: none;
}

.Sample__amount {
  width: 56px;
  margin-left: auto;
}
</style>
