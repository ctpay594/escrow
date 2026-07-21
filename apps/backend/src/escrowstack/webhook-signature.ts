import { createPublicKey, createVerify, type KeyObject } from 'crypto';

export function normalizePublicKey(publicKeyPem: string): string {
  let key = publicKeyPem.trim();

  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  key = key.replace(/\\n/g, '\n').replace(/\\r/g, '\r');

  const spkiMatch = key.match(
    /-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----/,
  );
  if (spkiMatch) {
    const body = spkiMatch[1].replace(/\s+/g, '');
    const lines = body.match(/.{1,64}/g) ?? [body];

    return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
  }

  const body = key.replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [body];

  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

export function loadPublicKey(publicKeyPem: string): KeyObject {
  return createPublicKey(normalizePublicKey(publicKeyPem));
}

export function verifyEscrowWebhookSignature(
  payload: Record<string, unknown>,
  signature: string,
  publicKeyPem: string,
): boolean {
  const unsigned = { ...payload };
  delete unsigned.signature;

  const message = JSON.stringify(unsigned);
  const verifier = createVerify('RSA-SHA256');

  verifier.update(message);
  verifier.end();

  return verifier.verify(loadPublicKey(publicKeyPem), signature, 'base64');
}
