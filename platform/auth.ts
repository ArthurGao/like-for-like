// STAND-IN for an Amazon Cognito ID token. Tokens are signed and verified with a key pair
// generated in this process. There is no Cognito, no JWKS endpoint and no real user pool.
import { SignJWT, generateKeyPair, jwtVerify, type CryptoKey } from 'jose';

export const ISSUER = 'https://local-stand-in.invalid/like-for-like';
export const AUDIENCE = 'like-for-like';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare const verified: unique symbol;

/** Claims that passed signature and claim checks. Only verifyToken() produces this type. */
export type VerifiedClaims = {
  readonly sub: string;
  readonly 'custom:tenant_id': string;
  readonly 'cognito:groups': readonly string[];
  readonly [verified]: true;
};

let keys: Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> | undefined;
const keyPair = () => (keys ??= generateKeyPair('RS256'));

export async function signToken(input: {
  sub: string;
  tenantId: string;
  groups?: string[];
}): Promise<string> {
  const { privateKey } = await keyPair();
  return new SignJWT({
    'custom:tenant_id': input.tenantId,
    'cognito:groups': input.groups ?? ['staff'],
    token_use: 'id',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(input.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);
}

export async function verifyToken(token: string): Promise<VerifiedClaims> {
  const { publicKey } = await keyPair();
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['RS256'],
  });
  const tenantId = payload['custom:tenant_id'];
  const groups = payload['cognito:groups'];
  if (payload.token_use !== 'id') throw new Error('token_use must be "id"');
  if (typeof payload.sub !== 'string' || payload.sub === '') throw new Error('sub is missing');
  if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) {
    throw new Error('custom:tenant_id is missing or not a uuid');
  }
  if (!Array.isArray(groups) || !groups.every((g) => typeof g === 'string')) {
    throw new Error('cognito:groups must be a string array');
  }
  return { sub: payload.sub, 'custom:tenant_id': tenantId, 'cognito:groups': groups } as unknown as VerifiedClaims;
}
