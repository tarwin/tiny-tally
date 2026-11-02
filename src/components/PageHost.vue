<script setup lang="ts">
// Wraps each page App.vue keeps alive, giving it a route of its own
// (pageRoute in tabs.ts): useRoute() in a page in a hidden tab doesn't move
// when another tab navigates.
import { onBeforeUnmount, provide, type Component } from 'vue';
import { routeLocationKey } from 'vue-router';
import { pageRoute } from '../lib/tabs';

const props = defineProps<{ page: Component; pageKey: string }>();
const { route, stop } = pageRoute(props.pageKey);
provide(routeLocationKey, route);
onBeforeUnmount(stop);
</script>

<template>
  <component :is="props.page" />
</template>
