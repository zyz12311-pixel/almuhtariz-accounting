import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomFillSync,
  sign as signBytes,
  verify as verifyBytes,
  X509Certificate,
} from 'node:crypto';

const SHA256 = 'SHA-256';
const CURVE = 'secp256k1';

function bytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Expected binary input');
}

function arrayBuffer(value) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}

function assertAlgorithm(algorithm) {
  const hash = typeof algorithm?.hash === 'string' ? algorithm.hash : algorithm?.hash?.name;
  if (algorithm?.name !== 'ECDSA' || hash !== SHA256) {
    throw new Error('Only ECDSA with SHA-256 is enabled for ZATCA signing');
  }
}

function assertKey(key) {
  const nodeKey = key?.nodeKey || key;
  if (!nodeKey || nodeKey.asymmetricKeyType !== 'ec' || nodeKey.asymmetricKeyDetails?.namedCurve !== CURVE) {
    throw new Error('Only secp256k1 keys are enabled for ZATCA signing');
  }
  return nodeKey;
}

export function wrapEcdsaKey(nodeKey, usages) {
  const key = assertKey(nodeKey);
  return {
    type: key.type,
    extractable: false,
    algorithm: { name: 'ECDSA', namedCurve: 'K-256', hash: { name: SHA256 } },
    usages: [...usages],
    nodeKey: key,
  };
}

export function createNodeCryptoProvider() {
  const subtle = {
    async digest(algorithm, data) {
      const name = typeof algorithm === 'string' ? algorithm : algorithm?.name;
      if (name !== SHA256) throw new Error('Only SHA-256 digests are enabled for ZATCA signing');
      return arrayBuffer(createHash('sha256').update(bytes(data)).digest());
    },
    async sign(algorithm, key, data) {
      assertAlgorithm(algorithm);
      const nodeKey = assertKey(key);
      if (nodeKey.type !== 'private') throw new Error('A private ECDSA key is required for signing');
      return arrayBuffer(signBytes('sha256', bytes(data), nodeKey));
    },
    async verify(algorithm, key, signature, data) {
      assertAlgorithm(algorithm);
      const nodeKey = assertKey(key);
      if (nodeKey.type !== 'public') throw new Error('A public ECDSA key is required for verification');
      return verifyBytes('sha256', bytes(data), nodeKey, bytes(signature));
    },
    async importKey(format, keyData, algorithm, extractable, usages) {
      assertAlgorithm(algorithm);
      const type = format === 'pkcs8' ? 'private' : format === 'spki' ? 'public' : null;
      if (!type) throw new Error('Only PKCS#8 private keys and SPKI public keys are supported');
      const key = type === 'private'
        ? createPrivateKey({ key: bytes(keyData), format: 'der', type: 'pkcs8' })
        : createPublicKey({ key: bytes(keyData), format: 'der', type: 'spki' });
      return { ...wrapEcdsaKey(key, usages), extractable: Boolean(extractable) };
    },
    async exportKey(format, key) {
      const nodeKey = assertKey(key);
      if ((format === 'pkcs8' && nodeKey.type !== 'private') || (format === 'spki' && nodeKey.type !== 'public')) {
        throw new Error('Key format does not match key type');
      }
      if (!['pkcs8', 'spki'].includes(format)) throw new Error('Only PKCS#8 and SPKI exports are supported');
      const type = format === 'pkcs8' ? 'pkcs8' : 'spki';
      return arrayBuffer(nodeKey.export({ format: 'der', type }));
    },
    async generateKey(algorithm, extractable, usages) {
      assertAlgorithm(algorithm);
      const pair = generateKeyPairSync('ec', { namedCurve: CURVE });
      return {
        privateKey: { ...wrapEcdsaKey(pair.privateKey, usages), extractable: Boolean(extractable) },
        publicKey: { ...wrapEcdsaKey(pair.publicKey, usages), extractable: true },
      };
    },
  };

  return {
    subtle,
    getRandomValues(value) {
      randomFillSync(value);
      return value;
    },
  };
}

export function loadEcdsaPrivateKey(pem) {
  const key = createPrivateKey(pem);
  assertKey(key);
  return wrapEcdsaKey(key, ['sign']);
}

export function loadEcdsaCertificate(pem) {
  const certificate = new X509Certificate(pem);
  assertKey(certificate.publicKey);
  return certificate;
}
