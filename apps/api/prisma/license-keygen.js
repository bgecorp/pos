// Generates the Ed25519 key pair used to sign POS license tokens.
//   npm run license:keygen -w @pos/api
// Put LICENSE_PRIVATE_KEY in apps/api/.env (secret!) and the public key in
// apps/pos/server/license-public-key.ts (safe to share: it can only verify).
// Changing keys invalidates every POS's cached token until it refreshes online.
const { generateKeyPairSync } = require('node:crypto');

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

console.log(`LICENSE_PRIVATE_KEY=${priv}`);
console.log(`LICENSE_PUBLIC_KEY=${pub}`);
