import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InitialSchema1700000000000 } from './src/migrations/1700000000000-InitialSchema.js';

const ds = new DataSource({
  type: 'postgres',
  host: '127.0.0.1', port: 5432,
  username: 'mymemory', password: 'mymemory_secret',
  database: 'mymemory',
  synchronize: false, logging: true,
  entities: [], migrations: [InitialSchema1700000000000],
  migrationsTableName: 'typeorm_migrations'
});

await ds.initialize();
console.log('Init OK');
try {
  const result = await ds.runMigrations({ transaction: 'each' });
  console.log('runMigrations OK, ran:', result.length);
} catch(e: any) {
  console.error('FAIL at:', e.query ?? 'unknown');
  console.error('FAIL msg:', e.message?.substring(0, 200));
  console.error('FAIL cause:', e.driverError?.message?.substring(0, 200));
}
await ds.destroy();
