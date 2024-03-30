import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['src/index.ts', 'src/vue/index.ts'],
    format: ['esm', 'cjs'],
    clean: true,
    shims: true,
    sourcemap: true,
    dts: false,
    external: ['@vueuse/core', 'vue'],
})
