/**
 * Real RSA key pair generated for contract/integration tests only.
 * These keys are for local testing — never use in production.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TEST_PRIVATE_KEY = fs.readFileSync(path.join(__dirname, 'test-private.pem'), 'utf-8');
export const TEST_PUBLIC_KEY = fs.readFileSync(path.join(__dirname, 'test-public.pem'), 'utf-8');

export const TEST_CONFIG = {
  nodeEnv: 'test' as const,
  port: 3000,
  databaseUrl: 'postgresql://test:test@localhost:5432/test',
  objectStore: {
    endpoint: 'http://localhost:9000',
    bucket: 'test',
    accessKey: 'test',
    secretKey: 'test',
    region: 'us-east-1',
  },
  jwt: {
    publicKeyPath: './tests/fixtures/test-public.pem',
    privateKeyPath: './tests/fixtures/test-private.pem',
    publicKey: TEST_PUBLIC_KEY,
    privateKey: TEST_PRIVATE_KEY,
  },
  anthropicApiKey: 'test-anthropic-key',
};
