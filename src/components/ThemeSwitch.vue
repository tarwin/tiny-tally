<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Button, getResolvedTheme, onThemeChange } from '@octans/ui';
import { toggleTheme } from '../lib/theme';

// Track what's actually on screen, including OS changes while on "System".
const resolved = ref(getResolvedTheme());
const off = onThemeChange((t) => (resolved.value = t));
onBeforeUnmount(off);

const isDark = computed(() => resolved.value === 'dark');
</script>

<template>
  <Button
    type="plain"
    :icon="isDark ? 'mdi:white-balance-sunny' : 'mdi:weather-night'"
    :tooltip="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    tooltip-position="left"
    @click="toggleTheme"
  />
</template>
