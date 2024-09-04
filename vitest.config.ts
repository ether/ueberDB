import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        testTimeout: 120000,
        hookTimeout: 120000,
        poolOptions: {
            vmForks: {
                // VM forks related options here
            },

        }
    }
})
