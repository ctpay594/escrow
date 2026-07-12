import { createPrivateKey, createSign, type KeyObject } from 'crypto';

export function getIndianPayoutTimestamp(): string {
  // Match Postman pre-request script exactly (no hour12 option).
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
  });
}

export function normalizePrivateKey(privateKey: string): string {
  let key = privateKey.trim();

  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  key = key.replace(/\\n/g, '\n').replace(/\\r/g, '\r');

  const pkcs8Match = key.match(
    /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/,
  );
  if (pkcs8Match) {
    const body = pkcs8Match[1].replace(/\s+/g, '');
    const lines = body.match(/.{1,64}/g) ?? [body];

    return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
  }

  const rsaMatch = key.match(
    /-----BEGIN RSA PRIVATE KEY-----([\s\S]*?)-----END RSA PRIVATE KEY-----/,
  );
  if (rsaMatch) {
    const body = rsaMatch[1].replace(/\s+/g, '');
    const lines = body.match(/.{1,64}/g) ?? [body];

    return `-----BEGIN RSA PRIVATE KEY-----\n${lines.join('\n')}\n-----END RSA PRIVATE KEY-----`;
  }

  const body = key.replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [body];

  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

export function loadPrivateKey(privateKeyPem: string): KeyObject {
  try {
    return createPrivateKey(normalizePrivateKey(privateKeyPem));
  } catch {
    throw new Error(
      'Invalid EscrowStack private key. Re-enter the full PEM key in admin portal.',
    );
  }
}

export function signPayoutPayload(
  payload: Record<string, unknown>,
  privateKeyPem: string,
): string {
  const unsignedJson = JSON.stringify(payload);
  const privateKey = loadPrivateKey(privateKeyPem);
  const signer = createSign('RSA-SHA256');

  signer.update(unsignedJson);
  signer.end();

  return signer.sign(privateKey, 'base64');
}
