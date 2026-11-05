import { createApp, watchEffect } from 'vue'
import UI, { applyCustomTheme, createTheme, setDateFormat } from '@octans/ui'
import '@octans/ui/style.css'
import '@octans/ui/reset.css'
import './octansIcons'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { session } from './lib/session'
import { DATE_FIELD_FORMATS } from './lib/dates'

// Brand colours from the Tiny Tally logo.
const theme = createTheme({ name: 'Tiny Tally', primary: '#2d8c49', secondary: '#193149', warning: '#f99d1f', radius: 'large' })
// The green sits just under 4.5:1 against white, so createTheme picks dark
// labels. White reads better on it and matches the logo.
theme.tokens['text-on-primary'] = '#ffffff'
applyCustomTheme(theme)

// Date fields follow the books' Dates setting.
watchEffect(() => setDateFormat(session.books ? DATE_FIELD_FORMATS[session.books.dateFormat] : null))

createApp(App).use(UI).use(router).mount('#app')
