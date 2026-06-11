import 'dotenv/config';
import { DataSource } from 'typeorm';

// Standalone DataSource used by the TypeORM CLI (migration:generate/run/revert).
// Mirrors the connection config in app.module.ts but is independent of Nest's
// DI container so it can be loaded directly by the CLI.
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'auth_db',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
  synchronize: false,
});
