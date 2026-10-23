import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Blockly alone is ~800 kB minified; split it out later if load time matters.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // The app, and the guide (docs/wiki rendered as a page of the site).
      input: { main: resolve(__dirname, "index.html"), guide: resolve(__dirname, "guide.html") },
    },
  },
});
