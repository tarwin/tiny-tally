import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import CustomTabs from './components/CustomTabs.vue';
import PageLink from './components/PageLink.vue';
import DownloadLink from './components/DownloadLink.vue';
import VideoEmbed from './components/VideoEmbed.vue';
import { useImageZoom } from './zoom';
import './style.css';

export default {
  extends: DefaultTheme,
  // The components behind the ::: containers in ../markdown.ts.
  enhanceApp({ app }) {
    app.component('CustomTabs', CustomTabs);
    app.component('PageLink', PageLink);
    app.component('DownloadLink', DownloadLink);
    app.component('VideoEmbed', VideoEmbed);
  },
  setup() {
    useImageZoom();
  },
} satisfies Theme;
