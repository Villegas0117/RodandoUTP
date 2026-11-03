import { defineConfig } from '@neon/config';

export default defineConfig({
  functions: {
    api: {
      name: 'api',
      source: './functions/api.ts',
      env: {
        CORS_ORIGIN: '*',
      },
    },
  },
});
