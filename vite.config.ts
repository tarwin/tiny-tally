import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    rolldownOptions: {
      output: {
        // Vendor code in a few stable chunks rather than one big one, so an
        // app update doesn't re-ship the libraries.
        codeSplitting: {
          groups: [
            { name: 'vue', test: /node_modules[\\/](@vue|vue|vue-router)[\\/]/, priority: 3 },
            { name: 'octans', test: /node_modules[\\/]@octans[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
