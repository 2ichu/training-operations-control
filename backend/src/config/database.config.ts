import { registerAs } from '@nestjs/config';

export interface DatabaseConfig {
  url: string | undefined;
  poolMax: number;
}

export default registerAs(
  'database',
  (): DatabaseConfig => ({
    url: process.env.DATABASE_URL,
    poolMax: Number(process.env.DB_POOL_MAX ?? 10),
  }),
);
