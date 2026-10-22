import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Blockly alone is ~800 kB minified; split it out later if load time matters.
    chunkSizeWarningLimit: 1500,
  },
});
