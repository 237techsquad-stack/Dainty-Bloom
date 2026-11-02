import { createPublicKey, verify } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const operationSchema = z.enum([
  'artwork_migration_dry_run',
  'artwork_migration_write',
]);
export const ARTWORK_MIGRATION_DATABASE_ROLE = 'artwork_migration';

const configurationSchema = z
  .object({
    ARTWORK_MIGRATION_MONGODB_URI: z.string().min(1),
    ARTWORK_MIGRATION_DEPLOYMENT_ID: z.string().min(3).max(128),
    ARTWORK_MIGRATION_DATABASE_NAME: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[A-Za-z0-9_-]+$/),
    ARTWORK_MIGRATION_DATABASE_ROLE: z.literal(ARTWORK_MIGRATION_DATABASE_ROLE),
    ARTWORK_MIGRATION_TLS_SERVER_HOSTNAME: z.string().min(1).max(253),
    ARTWORK_MIGRATION_TLS_CA_FILE: z.string().min(1),
    ARTWORK_MIGRATION_AUTHORIZATION_MANIFEST_FILE: z.string().min(1),
    ARTWORK_MIGRATION_AUTHORIZATION_PUBLIC_KEY_FILE: z.string().min(1),
    ARTWORK_MIGRATION_RUN_ID: z.string().uuid(),
    ARTWORK_MIGRATION_AUTHORIZATION_EXPIRES_AT: z
      .string()
      .datetime({ offset: true }),
    ARTWORK_MIGRATION_OPERATION: operationSchema,
    ARTWORK_MIGRATION_MONGODB_CREDENTIAL_REF: z.string().min(1),
    ARTWORK_MIGRATION_SOURCE_PRIVATE_DIR: z.string().min(1),
    ARTWORK_MIGRATION_UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(100_000_000),
  })
  .strict();

const authorizationPayloadSchema = z
  .object({
    deploymentIdentity: z.string().min(3).max(128),
    databaseName: z.string().min(1).max(63),
    databaseRole: z.literal(ARTWORK_MIGRATION_DATABASE_ROLE),
    tlsServerHostname: z.string().min(1).max(253),
    runId: z.string().uuid(),
    operation: operationSchema,
    issuedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    identityMarker: z
      .object({
        collection: z.literal('_migrationIdentity'),
        id: z.literal('artwork-migration'),
        deploymentIdentity: z.string().min(3).max(128),
        databaseName: z.string().min(1).max(63),
        markerVersion: z.literal(1),
      })
      .strict(),
  })
  .strict();

const signedManifestSchema = z
  .object({
    version: z.literal(1),
    payload: authorizationPayloadSchema,
    signature: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/, 'Signature must be unpadded base64url'),
  })
  .strict();

const credentialSchema = z
  .object({
    username: z.string().min(1),
    password: z.string().min(1),
    authSource: z.string().min(1),
    roleName: z.literal(ARTWORK_MIGRATION_DATABASE_ROLE),
  })
  .strict();

export type ArtworkMigrationOperation = z.infer<typeof operationSchema>;
export type ArtworkMigrationAuthorizationPayload = z.infer<
  typeof authorizationPayloadSchema
>;
export type ArtworkMigrationConfiguration = {
  mongoUri: string;
  deploymentIdentity: string;
  databaseName: string;
  databaseRole: typeof ARTWORK_MIGRATION_DATABASE_ROLE;
  tlsServerHostname: string;
  tlsCaFile: string;
  manifestFile: string;
  publicKeyFile: string;
  runId: string;
  expiresAt: string;
  operation: ArtworkMigrationOperation;
  credentialReference: string;
  sourcePrivateDirectory: string;
  uploadMaxBytes: number;
};

export interface ArtworkMigrationMongoCredential {
  username: string;
  password: string;
  authSource: string;
  roleName: typeof ARTWORK_MIGRATION_DATABASE_ROLE;
}

export class ArtworkMigrationAuthorizationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ArtworkMigrationAuthorizationError';
  }
}

export async function loadArtworkMigrationConfiguration(
  source: NodeJS.ProcessEnv = process.env,
): Promise<ArtworkMigrationConfiguration> {
  const parsed = configurationSchema.safeParse({
    ARTWORK_MIGRATION_MONGODB_URI: source.ARTWORK_MIGRATION_MONGODB_URI,
    ARTWORK_MIGRATION_DEPLOYMENT_ID: source.ARTWORK_MIGRATION_DEPLOYMENT_ID,
    ARTWORK_MIGRATION_DATABASE_NAME: source.ARTWORK_MIGRATION_DATABASE_NAME,
    ARTWORK_MIGRATION_DATABASE_ROLE: source.ARTWORK_MIGRATION_DATABASE_ROLE,
    ARTWORK_MIGRATION_TLS_SERVER_HOSTNAME:
      source.ARTWORK_MIGRATION_TLS_SERVER_HOSTNAME,
    ARTWORK_MIGRATION_TLS_CA_FILE: source.ARTWORK_MIGRATION_TLS_CA_FILE,
    ARTWORK_MIGRATION_AUTHORIZATION_MANIFEST_FILE:
      source.ARTWORK_MIGRATION_AUTHORIZATION_MANIFEST_FILE,
    ARTWORK_MIGRATION_AUTHORIZATION_PUBLIC_KEY_FILE:
      source.ARTWORK_MIGRATION_AUTHORIZATION_PUBLIC_KEY_FILE,
    ARTWORK_MIGRATION_RUN_ID: source.ARTWORK_MIGRATION_RUN_ID,
    ARTWORK_MIGRATION_AUTHORIZATION_EXPIRES_AT:
      source.ARTWORK_MIGRATION_AUTHORIZATION_EXPIRES_AT,
    ARTWORK_MIGRATION_OPERATION: source.ARTWORK_MIGRATION_OPERATION,
    ARTWORK_MIGRATION_MONGODB_CREDENTIAL_REF:
      source.ARTWORK_MIGRATION_MONGODB_CREDENTIAL_REF,
    ARTWORK_MIGRATION_SOURCE_PRIVATE_DIR:
      source.ARTWORK_MIGRATION_SOURCE_PRIVATE_DIR,
    ARTWORK_MIGRATION_UPLOAD_MAX_BYTES:
      source.ARTWORK_MIGRATION_UPLOAD_MAX_BYTES,
  });
  if (!parsed.success) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CONFIGURATION_INVALID',
    );
  }

  const values = parsed.data;
  const uri = parseMigrationMongoUri(
    values.ARTWORK_MIGRATION_MONGODB_URI,
    values.ARTWORK_MIGRATION_DATABASE_NAME,
  );
  const tlsServerHostname = validateTlsHostname(
    values.ARTWORK_MIGRATION_TLS_SERVER_HOSTNAME,
  );
  const tlsCaFile = requireAbsolutePath(values.ARTWORK_MIGRATION_TLS_CA_FILE);
  const manifestFile = requireAbsolutePath(
    values.ARTWORK_MIGRATION_AUTHORIZATION_MANIFEST_FILE,
  );
  const publicKeyFile = requireAbsolutePath(
    values.ARTWORK_MIGRATION_AUTHORIZATION_PUBLIC_KEY_FILE,
  );
  const sourcePrivateDirectory = requireAbsolutePath(
    values.ARTWORK_MIGRATION_SOURCE_PRIVATE_DIR,
  );
  const expiresAt = new Date(
    values.ARTWORK_MIGRATION_AUTHORIZATION_EXPIRES_AT,
  ).toISOString();

  await Promise.all([
    assertRegularFile(tlsCaFile, 'MIGRATION_TLS_CA_UNAVAILABLE'),
    assertRegularFile(manifestFile, 'MIGRATION_AUTHORIZATION_UNAVAILABLE'),
    assertRegularFile(publicKeyFile, 'MIGRATION_PUBLIC_KEY_UNAVAILABLE'),
  ]);
  try {
    const ca = await readFile(tlsCaFile);
    const pem = ca.toString('utf8');
    const certificates = [
      ...pem.matchAll(
        /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
      ),
    ];
    if (certificates.length === 0) throw new Error('Invalid CA');
    for (const certificate of certificates) {
      new X509Certificate(certificate[0]);
    }
  } catch {
    throw new ArtworkMigrationAuthorizationError('MIGRATION_TLS_CA_INVALID');
  }

  return {
    mongoUri: uri,
    deploymentIdentity: values.ARTWORK_MIGRATION_DEPLOYMENT_ID,
    databaseName: values.ARTWORK_MIGRATION_DATABASE_NAME,
    databaseRole: values.ARTWORK_MIGRATION_DATABASE_ROLE,
    tlsServerHostname,
    tlsCaFile,
    manifestFile,
    publicKeyFile,
    runId: values.ARTWORK_MIGRATION_RUN_ID,
    expiresAt,
    operation: values.ARTWORK_MIGRATION_OPERATION,
    credentialReference: values.ARTWORK_MIGRATION_MONGODB_CREDENTIAL_REF,
    sourcePrivateDirectory,
    uploadMaxBytes: values.ARTWORK_MIGRATION_UPLOAD_MAX_BYTES,
  };
}

export async function verifyArtworkMigrationAuthorization(
  configuration: ArtworkMigrationConfiguration,
  now: Date = new Date(),
): Promise<ArtworkMigrationAuthorizationPayload> {
  let manifestBytes: Buffer;
  let publicKeyBytes: Buffer;
  try {
    [manifestBytes, publicKeyBytes] = await Promise.all([
      readFile(configuration.manifestFile),
      readFile(configuration.publicKeyFile),
    ]);
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_AUTHORIZATION_UNAVAILABLE',
    );
  }

  let manifestText: string;
  try {
    manifestText = new TextDecoder('utf-8', { fatal: true }).decode(
      manifestBytes,
    );
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_AUTHORIZATION_INVALID',
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(manifestText) as unknown;
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_AUTHORIZATION_INVALID',
    );
  }
  const parsed = signedManifestSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_AUTHORIZATION_INVALID',
    );
  }

  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey(publicKeyBytes);
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('Unsupported authorization key');
    }
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_PUBLIC_KEY_INVALID',
    );
  }

  const signature = Buffer.from(parsed.data.signature, 'base64url');
  if (
    signature.toString('base64url') !== parsed.data.signature ||
    !verify(
      null,
      Buffer.from(
        getArtworkMigrationManifestSigningBytes(
          parsed.data.version,
          parsed.data.payload,
        ),
      ),
      publicKey,
      signature,
    )
  ) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_AUTHORIZATION_SIGNATURE_INVALID',
    );
  }

  const payload = parsed.data.payload;
  assertManifestMatchesConfiguration(payload, configuration);
  assertAuthorizationWindow(payload, now);
  return payload;
}

export async function resolveArtworkMigrationCredential(
  reference: string,
  expectedRole: typeof ARTWORK_MIGRATION_DATABASE_ROLE,
): Promise<ArtworkMigrationMongoCredential> {
  let credentialPath: string;
  try {
    const url = new URL(reference);
    if (url.protocol !== 'file:' || url.search || url.hash) {
      throw new Error('Unsupported credential reference');
    }
    credentialPath = fileURLToPath(url);
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CREDENTIAL_REFERENCE_UNSUPPORTED',
    );
  }
  if (/^\.env(?:\..*)?$/i.test(path.basename(credentialPath))) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CREDENTIAL_REFERENCE_UNSUPPORTED',
    );
  }

  await assertRegularFile(credentialPath, 'MIGRATION_CREDENTIAL_UNAVAILABLE');
  if (process.platform !== 'win32') {
    const info = await lstat(credentialPath);
    if ((info.mode & 0o077) !== 0) {
      throw new ArtworkMigrationAuthorizationError(
        'MIGRATION_CREDENTIAL_PERMISSIONS_UNSAFE',
      );
    }
  } else {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CREDENTIAL_ACL_UNVERIFIABLE',
    );
  }

  let credentialData: unknown;
  try {
    credentialData = JSON.parse(
      await readFile(credentialPath, { encoding: 'utf8' }),
    ) as unknown;
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CREDENTIAL_INVALID',
    );
  }
  const parsed = credentialSchema.safeParse(credentialData);
  if (!parsed.success) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CREDENTIAL_INVALID',
    );
  }
  if (parsed.data.roleName !== expectedRole) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CREDENTIAL_SCOPE_MISMATCH',
    );
  }
  return parsed.data;
}

export function getArtworkMigrationManifestSigningBytes(
  version: 1,
  payload: ArtworkMigrationAuthorizationPayload,
): string {
  return canonicalJson({ version, payload });
}

function assertManifestMatchesConfiguration(
  payload: ArtworkMigrationAuthorizationPayload,
  configuration: ArtworkMigrationConfiguration,
): void {
  if (
    payload.deploymentIdentity !== configuration.deploymentIdentity ||
    payload.databaseName !== configuration.databaseName ||
    payload.databaseRole !== configuration.databaseRole ||
    payload.tlsServerHostname !== configuration.tlsServerHostname ||
    payload.runId !== configuration.runId ||
    payload.operation !== configuration.operation ||
    new Date(payload.expiresAt).toISOString() !== configuration.expiresAt ||
    payload.identityMarker.deploymentIdentity !==
      configuration.deploymentIdentity ||
    payload.identityMarker.databaseName !== configuration.databaseName
  ) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_AUTHORIZATION_TARGET_MISMATCH',
    );
  }
}

function assertAuthorizationWindow(
  payload: ArtworkMigrationAuthorizationPayload,
  now: Date,
): void {
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  const currentTime = now.getTime();
  const maximumLifetimeMs = 8 * 60 * 60 * 1000;
  const allowedClockSkewMs = 60 * 1000;
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= currentTime ||
    issuedAt > currentTime + allowedClockSkewMs ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > maximumLifetimeMs
  ) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_AUTHORIZATION_EXPIRED_OR_INVALID',
    );
  }
}

function parseMigrationMongoUri(
  uriValue: string,
  databaseName: string,
): string {
  let uri: URL;
  try {
    uri = new URL(uriValue);
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_MONGODB_URI_INVALID',
    );
  }
  let uriDatabase: string;
  try {
    uriDatabase = decodeURIComponent(uri.pathname.slice(1));
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_MONGODB_URI_INVALID',
    );
  }
  if (
    uri.protocol !== 'mongodb:' ||
    !uri.hostname ||
    uri.username ||
    uri.password ||
    uri.search ||
    uri.hash ||
    uriDatabase !== databaseName
  ) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_MONGODB_URI_INVALID',
    );
  }
  return uriValue;
}

function validateTlsHostname(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(`https://${value}`);
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_TLS_HOSTNAME_INVALID',
    );
  }
  if (
    parsed.hostname !== value.toLowerCase() ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_TLS_HOSTNAME_INVALID',
    );
  }
  return value.toLowerCase();
}

function requireAbsolutePath(value: string): string {
  if (!path.isAbsolute(value)) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CONFIGURATION_INVALID',
    );
  }
  return path.resolve(value);
}

async function assertRegularFile(
  filePath: string,
  code: string,
): Promise<void> {
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(code);
  } catch {
    throw new ArtworkMigrationAuthorizationError(code);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_AUTHORIZATION_INVALID',
    );
  }
  return serialized;
}
