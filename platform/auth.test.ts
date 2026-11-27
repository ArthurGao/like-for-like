import { SignJWT, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { AUDIENCE, ISSUER, signToken, verifyToken } from './auth.ts';

const TENANT = '3f1c2a5e-8d4b-4c6a-9e2f-1a2b3c4d5e6f';

describe('stand-in Cognito tokens', () => {
  it('round-trips the Cognito-shaped claims', async () => {
    const claims = await verifyToken(await signToken({ sub: 'u1', tenantId: TENANT, groups: ['payroll'] }));
    expect({ ...claims }).toEqual({ sub: 'u1', 'custom:tenant_id': TENANT, 'cognito:groups': ['payroll'] });
  });

  it('rejects a token signed with another key', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const forged = await new SignJWT({ 'custom:tenant_id': TENANT, 'cognito:groups': [], token_use: 'id' })
      .setProtectedHeader({ alg: 'RS256' }).setSubject('u1').setIssuer(ISSUER).setAudience(AUDIENCE)
      .setExpirationTime('5m').sign(privateKey);
    await expect(verifyToken(forged)).rejects.toThrow('signature verification failed');
  });

  it('rejects a tenant id that is not a uuid', async () => {
    await expect(verifyToken(await signToken({ sub: 'u1', tenantId: '1' }))).rejects.toThrow(
      'custom:tenant_id is missing or not a uuid',
    );
  });

  it('rejects a tampered payload', async () => {
    const [h, , s] = (await signToken({ sub: 'u1', tenantId: TENANT })).split('.');
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', 'custom:tenant_id': 'b0000000-0000-4000-8000-00000000000b' })).toString('base64url');
    await expect(verifyToken(`${h}.${payload}.${s}`)).rejects.toThrow();
  });
});
