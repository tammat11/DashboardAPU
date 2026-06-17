import { mkdir } from 'node:fs/promises';

await mkdir('public', { recursive: true });
console.log('DashboardAPU build: static public/ directory is ready.');
