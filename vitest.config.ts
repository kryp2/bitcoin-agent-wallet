import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    // Source files use NodeNext-style `.js` import specifiers that actually
    // point at `.ts` files (tsconfig moduleResolution: "bundler"). Map those
    // back to the TypeScript sources so Vitest can load them without a build.
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
})
