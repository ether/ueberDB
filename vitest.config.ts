import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        testTimeout: 120000,
        hookTimeout: 120000,
        // Integration tests against real DB containers are inherently a
        // little flaky on shared CI runners (network blips, slow startup,
        // intermittent connection resets). Retry each test up to twice
        // before giving up so a single transient blip doesn't fail the
        // whole job. The underlying bug should still surface if the test
        // fails consistently.
        retry: 2,
        poolOptions: {
            vmForks: {
                // VM forks related options here
            },

        }
    }
})
