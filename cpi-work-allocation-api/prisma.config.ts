import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  // Moved from package.json#prisma (deprecated in Prisma 6, removed in Prisma 7)
  seed: 'tsx prisma/seed.ts',
});
