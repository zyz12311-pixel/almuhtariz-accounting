import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createNodeCryptoProvider, wrapEcdsaKey } from '../server/zatca/node-crypto.js';

const pair = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
const provider = createNodeCryptoProvider();
const privateKey = wrapEcdsaKey(pair.privateKey, ['sign']);
const publicKey = wrapEcdsaKey(pair.publicKey, ['verify']);
const data = Buffer.from('ZATCA test signature');
const algorithm = { name: 'ECDSA', hash: { name: 'SHA-256' } };
const signature = await provider.subtle.sign(algorithm, privateKey, data);

assert.equal(await provider.subtle.verify(algorithm, publicKey, signature, data), true);
assert.equal(await provider.subtle.verify(algorithm, publicKey, signature, Buffer.from('different')), false);
await assert.rejects(() => provider.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-1' } }, privateKey, data), /Only ECDSA with SHA-256/);
assert.throws(() => wrapEcdsaKey(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey, ['sign']), /Only secp256k1/);

console.log('PASS: Node crypto provider signs and verifies secp256k1 ECDSA/SHA-256 and rejects unsupported curves and digests');
