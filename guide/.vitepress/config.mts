// The Tiny Tally user guide. Built and published to the microsite at
// apps.tarwin.art/tiny-tally/docs/ by scripts/publish-docs.sh; preview with
// `pnpm docs:dev`.
import { defineConfig } from 'vitepress';
import markdownExtras from './markdown';

export default defineConfig({
  title: 'Tiny Tally Guide',
  description: 'How to use Tiny Tally: books for a small business, kept in one file on your own computer.',
  base: '/tiny-tally/docs/',
  lang: 'en',
  cleanUrls: true,
  // ::: tabs / pagelink / download / carousel / embed, image captions + zoom
  markdown: { config: markdownExtras },
  lastUpdated: false,
  head: [
    ['link', { rel: 'icon', href: '/tiny-tally/docs/icon.png', type: 'image/png' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap',
      },
    ],
  ],
  themeConfig: {
    logo: '/icon.png',
    siteTitle: 'Tiny Tally',
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Download', link: 'https://apps.tarwin.art/tiny-tally/' },
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Your books file', link: '/your-books-file' },
        ],
      },
      {
        text: 'Day to day',
        items: [
          { text: 'Recording transactions', link: '/transactions' },
          { text: 'Importing and rules', link: '/importing' },
          { text: 'Money accounts and reconciling', link: '/accounts' },
          { text: 'Recurring transactions', link: '/recurring' },
        ],
      },
      {
        text: 'Selling and buying',
        items: [
          { text: 'Invoices, quotes and credit notes', link: '/invoices' },
          { text: 'Templates and trading names', link: '/templates' },
          { text: 'Bills', link: '/bills' },
          { text: 'Contacts, products and services', link: '/contacts' },
        ],
      },
      {
        text: 'Reports and tax',
        items: [
          { text: 'Reports', link: '/reports' },
          { text: 'Budget', link: '/budget' },
          { text: 'Tax returns', link: '/tax' },
        ],
      },
      {
        text: 'More',
        items: [
          { text: 'Tabs, windows and search', link: '/tabs-and-search' },
          { text: 'Keyboard shortcuts', link: '/shortcuts' },
          { text: 'For your accountant', link: '/accountants' },
          { text: 'Settings', link: '/settings' },
        ],
      },
    ],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/tarwin/tiny-tally' }],
    outline: { level: [2, 3], label: 'On this page' },
    docFooter: { prev: 'Previous', next: 'Next' },
    footer: { message: 'Tiny Tally is free, by Tarwin Stroh-Spijer.' },
  },
});
