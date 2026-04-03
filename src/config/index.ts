import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  OBJECT_STORE_ENDPOINT: z.string().url(),
  OBJECT_STORE_BUCKET: z.string().min(1),
  OBJECT_STORE_ACCESS_KEY: z.string().min(1),
  OBJECT_STORE_SECRET_KEY: z.string().min(1),
  OBJECT_STORE_REGION: z.string().default('us-east-1'),
  JWT_PUBLIC_KEY_PATH: z.string().min(1),
  JWT_PRIVATE_KEY_PATH: z.string().optional(),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

function loadKey(keyPath: string): string {
  const resolved = path.resolve(keyPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Key file not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, 'utf-8');
}

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  objectStore: {
    endpoint: env.OBJECT_STORE_ENDPOINT,
    bucket: env.OBJECT_STORE_BUCKET,
    accessKey: env.OBJECT_STORE_ACCESS_KEY,
    secretKey: env.OBJECT_STORE_SECRET_KEY,
    region: env.OBJECT_STORE_REGION,
  },
  jwt: {
    publicKeyPath: env.JWT_PUBLIC_KEY_PATH,
    privateKeyPath: env.JWT_PRIVATE_KEY_PATH,
    get publicKey() {
      return loadKey(env.JWT_PUBLIC_KEY_PATH);
    },
  },
} as const;
