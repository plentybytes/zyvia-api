/**
 * Dev helper: generate a signed RS256 JWT for local testing.
 *
 * Usage:
 *   npm run dev:token -- --role provider --sub provider-001
 *   npm run dev:token -- --role patient --sub patient-abc-123
 *   npm run dev:token -- --role administrator --sub admin-001
 *
 * Keys are read from ./keys/dev-private.pem.
 * Run `npm run dev:token -- --generate-keys` to create a dev key pair.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SignJWT, importPKCS8 } from 'jose';

async function generateKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const keysDir = path.resolve('./keys');
  if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true });

  fs.writeFileSync(path.join(keysDir, 'dev-private.pem'), privateKey, { mode: 0o600 });
  fs.writeFileSync(path.join(keysDir, 'dev-public.pem'), publicKey);

  console.log('✓ Generated dev-private.pem and dev-public.pem in ./keys/');
  console.log('  Add JWT_PUBLIC_KEY_PATH=./keys/dev-public.pem to your .env');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--generate-keys')) {
    await generateKeys();
    return;
  }

  const roleIdx = args.indexOf('--role');
  const subIdx = args.indexOf('--sub');
  const expiryIdx = args.indexOf('--expiry');

  const role = roleIdx >= 0 ? args[roleIdx + 1] : 'provider';
  const sub = subIdx >= 0 ? args[subIdx + 1] : 'dev-user-001';
  const expiry = expiryIdx >= 0 ? args[expiryIdx + 1] : '24h';

  const privateKeyPath = process.env.JWT_PRIVATE_KEY_PATH ?? './keys/dev-private.pem';
  const resolved = path.resolve(privateKeyPath);

  if (!fs.existsSync(resolved)) {
    console.error(`Private key not found at ${resolved}`);
    console.error('Run: npm run dev:token -- --generate-keys');
    process.exit(1);
  }

  const pem = fs.readFileSync(resolved, 'utf-8');
  const privateKey = await importPKCS8(pem, 'RS256');

  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(privateKey);

  console.log(`Bearer ${token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
