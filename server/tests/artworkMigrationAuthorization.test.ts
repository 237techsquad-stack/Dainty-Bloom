import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { rootCertificates } from 'node:tls';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import type { Connection } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getArtworkMigrationManifestSigningBytes,
  loadArtworkMigrationConfiguration,
  resolveArtworkMigrationCredential,
  verifyArtworkMigrationAuthorization,
  type ArtworkMigrationAuthorizationPayload,
  type ArtworkMigrationConfiguration,
} from '../src/services/artworkMigrationAuthorization';
import {
  assertArtworkMigrationDatabasePermissions,
  assertArtworkMigrationTopology,
  assertArtworkMigrationIdentityMarker,
  buildArtworkMigrationConnectionOptions,
  createArtworkMigrationModel,
} from '../src/services/artworkMigrationConnection';
import {
  ARTWORK_ASSET_COLLECTION_NAME,
  artworkAssetSchema,
} from '../src/models/ArtworkAssetSchema';
import {
  runArtworkMigrationPreflight,
  type ArtworkMigrationPreflightDependencies,
} from '../src/services/artworkMigrationPreflight';
import {
  verifyArtworkMigrationCloudinaryIdentity,
  type ArtworkMigrationCloudinaryConfiguration,
} from '../src/services/artworkMigrationCloudinary';

const NOW = new Date('2026-03-01T12:00:00.000Z');

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'artwork-auth-test-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(fixtureRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('signed migration authorization', () => {
  it('accepts a valid versioned Ed25519 manifest for the configured target', async () => {
    const fixture = await createSignedFixture();
    const configuration = await loadArtworkMigrationConfiguration(
      fixture.environment,
    );

    await expect(
      verifyArtworkMigrationAuthorization(configuration, NOW),
    ).resolves.toEqual(fixture.payload);
  });

  it('rejects invalid manifest signatures', async () => {
    const fixture = await createSignedFixture();
    const manifest = JSON.parse(
      await readFile(
        fixture.environment.ARTWORK_MIGRATION_AUTHORIZATION_MANIFEST_FILE!,
        'utf8',
      ),
    ) as { version: number; payload: unknown; signature: string };
    manifest.signature = 'A'.repeat(86);
    await writeFile(
      fixture.environment.ARTWORK_MIGRATION_AUTHORIZATION_MANIFEST_FILE!,
      JSON.stringify(manifest),
    );

    const configuration = await loadArtworkMigrationConfiguration(
      fixture.environment,
    );
    await expect(
      verifyArtworkMigrationAuthorization(configuration, NOW),
    ).rejects.toMatchObject({
      code: 'MIGRATION_AUTHORIZATION_SIGNATURE_INVALID',
    });
  });

  it('does not resolve application .env files as migration credentials', async () => {
    const environmentFile = pathToFileURL(
      path.join(fixtureRoot, '.env'),
    ).toString();
    await expect(
      resolveArtworkMigrationCredential(environmentFile, 'artwork_migration'),
    ).rejects.toMatchObject({
      code: 'MIGRATION_CREDENTIAL_REFERENCE_UNSUPPORTED',
    });
  });

  it('rejects expired authorization evidence', async () => {
    const fixture = await createSignedFixture({
      issuedAt: '2026-02-28T10:00:00.000Z',
      expiresAt: '2026-02-28T11:00:00.000Z',
    });
    const configuration = await loadArtworkMigrationConfiguration(
      fixture.environment,
    );

    await expect(
      verifyArtworkMigrationAuthorization(configuration, NOW),
    ).rejects.toMatchObject({
      code: 'MIGRATION_AUTHORIZATION_EXPIRED_OR_INVALID',
    });
  });

  it.each([
    [
      'deployment identity',
      { deploymentIdentity: 'other-isolated-deployment' },
    ],
    ['database name', { databaseName: 'other_database' }],
    ['TLS hostname', { tlsServerHostname: 'other.test.invalid' }],
    ['run ID', { runId: randomUUID() }],
    ['operation', { operation: 'artwork_migration_write' as const }],
  ])('rejects a valid signature for a different %s', async (_label, change) => {
    const fixture = await createSignedFixture(change);
    const configuration = await loadArtworkMigrationConfiguration(
      fixture.environment,
    );

    await expect(
      verifyArtworkMigrationAuthorization(configuration, NOW),
    ).rejects.toMatchObject({
      code: 'MIGRATION_AUTHORIZATION_TARGET_MISMATCH',
    });
  });

  it('rejects an invalid CA file and a TLS hostname mismatch in configuration', async () => {
    const fixture = await createSignedFixture();
    await writeFile(
      fixture.environment.ARTWORK_MIGRATION_TLS_CA_FILE!,
      'not a certificate',
    );
    await expect(
      loadArtworkMigrationConfiguration(fixture.environment),
    ).rejects.toMatchObject({ code: 'MIGRATION_TLS_CA_INVALID' });

    await expect(
      loadArtworkMigrationConfiguration({
        ...fixture.environment,
        ARTWORK_MIGRATION_TLS_SERVER_HOSTNAME: 'host:27017',
      }),
    ).rejects.toMatchObject({
      code: 'MIGRATION_TLS_HOSTNAME_INVALID',
    });
  });

  it('rejects URI credentials and query-supplied TLS overrides', async () => {
    const fixture = await createSignedFixture();
    await expect(
      loadArtworkMigrationConfiguration({
        ...fixture.environment,
        ARTWORK_MIGRATION_MONGODB_URI:
          'mongodb://user:password@127.0.0.1:27017/dainty_bloom_isolated',
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_MONGODB_URI_INVALID' });

    await expect(
      loadArtworkMigrationConfiguration({
        ...fixture.environment,
        ARTWORK_MIGRATION_MONGODB_URI:
          'mongodb://127.0.0.1:27017/dainty_bloom_isolated?tlsInsecure=true',
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_MONGODB_URI_INVALID' });
  });

  it('always supplies strict TLS and disables automatic collection/index creation', async () => {
    const fixture = await createSignedFixture();
    const configuration = await loadArtworkMigrationConfiguration(
      fixture.environment,
    );
    const options = buildArtworkMigrationConnectionOptions(configuration, {
      username: 'artwork_migrator_test',
      password: 'test-only',
      authSource: 'dainty_bloom_isolated',
      roleName: 'artwork_migration',
    });

    expect(options).toMatchObject({
      directConnection: true,
      tls: true,
      tlsCAFile: configuration.tlsCaFile,
      tlsAllowInvalidCertificates: false,
      tlsAllowInvalidHostnames: false,
      tlsInsecure: false,
      servername: configuration.tlsServerHostname,
      autoCreate: false,
      autoIndex: false,
      bufferCommands: false,
    });
  });

  it('accepts only the dedicated database role and credential identity', async () => {
    const fixture = await createSignedFixture();
    const configuration = await loadArtworkMigrationConfiguration(
      fixture.environment,
    );
    const credential = {
      username: 'artwork_migrator_test',
      password: 'test-only',
      authSource: 'admin',
      roleName: 'artwork_migration' as const,
    };
    const status = {
      authenticatedUsers: [
        { user: credential.username, db: credential.authSource },
      ],
      authenticatedUserRoles: [
        { role: configuration.databaseRole, db: configuration.databaseName },
      ],
      authenticatedUserPrivileges: [
        {
          resource: {
            db: configuration.databaseName,
            collection: ARTWORK_ASSET_COLLECTION_NAME,
          },
          actions: ['find', 'update'],
        },
        {
          resource: {
            db: configuration.databaseName,
            collection: '_migrationIdentity',
          },
          actions: ['find'],
        },
      ],
    };

    expect(() =>
      assertArtworkMigrationDatabasePermissions(
        status,
        configuration,
        credential,
      ),
    ).not.toThrow();
    expect(() =>
      assertArtworkMigrationDatabasePermissions(
        {
          ...status,
          authenticatedUserRoles: [
            { role: 'readWrite', db: configuration.databaseName },
          ],
        },
        configuration,
        credential,
      ),
    ).toThrow('MIGRATION_DATABASE_PERMISSIONS_UNSAFE');
    expect(() =>
      assertArtworkMigrationDatabasePermissions(
        {
          ...status,
          authenticatedUserPrivileges: [
            ...status.authenticatedUserPrivileges,
            {
              resource: { db: configuration.databaseName, collection: '' },
              actions: ['find'],
            },
          ],
        },
        configuration,
        credential,
      ),
    ).toThrow('MIGRATION_DATABASE_PERMISSIONS_UNSAFE');
  });

  it('rejects database marker values that disagree with the signed manifest', async () => {
    const fixture = await createSignedFixture();
    const configuration = await loadArtworkMigrationConfiguration(
      fixture.environment,
    );
    const authorization = await verifyArtworkMigrationAuthorization(
      configuration,
      NOW,
    );

    expect(() =>
      assertArtworkMigrationIdentityMarker(
        {
          _id: authorization.identityMarker.id,
          deploymentIdentity: 'production',
          databaseName: authorization.databaseName,
          markerVersion: 1,
        },
        authorization,
      ),
    ).toThrow('MIGRATION_IDENTITY_MARKER_MISMATCH');
  });

  it('accepts only a single standalone MongoDB hello response', () => {
    expect(() =>
      assertArtworkMigrationTopology({
        ok: 1,
        isWritablePrimary: true,
      }),
    ).not.toThrow();
    for (const hello of [
      {
        ok: 1,
        isWritablePrimary: true,
        setName: 'replica-set',
        hosts: ['mongo-a.test.invalid:27017', 'mongo-b.test.invalid:27017'],
      },
      { ok: 1, isWritablePrimary: true, msg: 'isdbgrid' },
      { ok: 1, isWritablePrimary: true, serviceId: 'load-balanced' },
      { ok: 1 },
    ]) {
      expect(() => assertArtworkMigrationTopology(hello)).toThrow(
        'MIGRATION_CONNECTED_TOPOLOGY_UNSAFE',
      );
    }
  });

  it('binds ArtworkAsset to its explicit collection on the dedicated connection', () => {
    const model = {};
    const connection = {
      readyState: 1,
      model: vi.fn().mockReturnValue(model),
    } as unknown as Connection;

    expect(createArtworkMigrationModel(connection)).toBe(model);
    expect(connection.model).toHaveBeenCalledWith(
      'ArtworkAsset',
      artworkAssetSchema,
      ARTWORK_ASSET_COLLECTION_NAME,
    );
    expect(ARTWORK_ASSET_COLLECTION_NAME).toBe('artworkassets');
  });
});

describe('migration preflight ordering', () => {
  it('rejects write mode before reading configuration or opening side effects', async () => {
    const dependencies = makePreflightDependencies();
    await expect(
      runArtworkMigrationPreflight(['--write'], dependencies),
    ).rejects.toThrow('MIGRATION_WRITE_DISABLED_PENDING_IDENTITY_DESIGN');
    expect(dependencies.loadConfiguration).not.toHaveBeenCalled();
    expect(dependencies.connect).not.toHaveBeenCalled();
    expect(dependencies.openJournal).not.toHaveBeenCalled();
  });

  it('does not connect, open the journal, or initialize providers when authorization fails', async () => {
    const dependencies = makePreflightDependencies();
    vi.mocked(dependencies.verifyAuthorization).mockRejectedValue(
      new Error('MIGRATION_AUTHORIZATION_SIGNATURE_INVALID'),
    );

    await expect(
      runArtworkMigrationPreflight(['--dry-run'], dependencies),
    ).rejects.toThrow('MIGRATION_AUTHORIZATION_SIGNATURE_INVALID');
    expect(dependencies.connect).not.toHaveBeenCalled();
    expect(dependencies.verifyDatabaseIdentity).not.toHaveBeenCalled();
    expect(dependencies.loadCloudinaryConfiguration).not.toHaveBeenCalled();
    expect(dependencies.openJournal).not.toHaveBeenCalled();
  });

  it('keeps journal and provider access blocked when Cloudinary identity is unverifiable', async () => {
    const dependencies = makePreflightDependencies();
    vi.mocked(dependencies.verifyCloudinaryIdentity).mockRejectedValue(
      new Error('MIGRATION_CLOUDINARY_ACCOUNT_IDENTITY_UNVERIFIABLE'),
    );

    await expect(
      runArtworkMigrationPreflight(['--dry-run'], dependencies),
    ).rejects.toThrow('MIGRATION_CLOUDINARY_ACCOUNT_IDENTITY_UNVERIFIABLE');
    expect(dependencies.verifyDatabaseIdentity).toHaveBeenCalledOnce();
    expect(dependencies.openJournal).not.toHaveBeenCalled();
    expect(dependencies.connect.mock.results[0]?.value).toBeDefined();
  });

  it('rechecks authorization expiry before journal access', async () => {
    vi.useFakeTimers();
    const now = new Date();
    vi.setSystemTime(now);
    const dependencies = makePreflightDependencies();
    const expiresAt = new Date(now.getTime() + 1_000).toISOString();
    const payload = makePayload({
      runId: randomUUID(),
      issuedAt: new Date(now.getTime() - 60_000).toISOString(),
      expiresAt,
    });
    const configuration = await dependencies.loadConfiguration();
    configuration.runId = payload.runId;
    configuration.expiresAt = expiresAt;
    vi.mocked(dependencies.loadConfiguration).mockResolvedValue(configuration);
    vi.mocked(dependencies.verifyAuthorization).mockResolvedValue(payload);
    vi.mocked(dependencies.verifyDatabaseIdentity).mockImplementation(
      async () => {
        vi.setSystemTime(new Date(now.getTime() + 2_000));
      },
    );

    await expect(
      runArtworkMigrationPreflight(['--dry-run'], dependencies),
    ).rejects.toThrow('MIGRATION_AUTHORIZATION_EXPIRED_OR_INVALID');
    expect(dependencies.loadCloudinaryConfiguration).not.toHaveBeenCalled();
    expect(dependencies.openJournal).not.toHaveBeenCalled();
  });

  it('does not authorize Cloudinary from configured account labels alone', async () => {
    await expect(
      verifyArtworkMigrationCloudinaryIdentity({
        cloudName: 'test-cloud',
        accountIdentity: 'claimed-account',
        apiKey: 'test-key',
        apiSecret: 'test-secret',
      }),
    ).rejects.toMatchObject({
      code: 'MIGRATION_CLOUDINARY_ACCOUNT_IDENTITY_UNVERIFIABLE',
    });
  });
});

function makePreflightDependencies(): ArtworkMigrationPreflightDependencies {
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const fixtureConfiguration: ArtworkMigrationConfiguration = {
    mongoUri: 'mongodb://127.0.0.1:27017/dainty_bloom_isolated',
    deploymentIdentity: 'isolated-test-deployment',
    databaseName: 'dainty_bloom_isolated',
    databaseRole: 'artwork_migration',
    tlsServerHostname: 'mongo.test.invalid',
    tlsCaFile: path.join(fixtureRoot, 'ca.pem'),
    manifestFile: path.join(fixtureRoot, 'manifest.json'),
    publicKeyFile: path.join(fixtureRoot, 'authorization.pub'),
    runId: randomUUID(),
    expiresAt,
    operation: 'artwork_migration_dry_run',
    credentialReference: 'file:///not-read/test-credential.json',
    sourcePrivateDirectory: path.join(fixtureRoot, 'artwork'),
    uploadMaxBytes: 1024,
  };
  const payload = makePayload({
    runId: fixtureConfiguration.runId,
    expiresAt: fixtureConfiguration.expiresAt,
    issuedAt,
  });
  const connection = {
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Connection;
  return {
    loadConfiguration: vi.fn().mockResolvedValue(fixtureConfiguration),
    verifyAuthorization: vi.fn().mockResolvedValue(payload),
    resolveCredential: vi.fn().mockResolvedValue({
      username: 'artwork_migrator_test',
      password: 'test-only',
      authSource: 'dainty_bloom_isolated',
      roleName: 'artwork_migration',
    }),
    connect: vi.fn().mockResolvedValue(connection),
    verifyDatabaseIdentity: vi.fn().mockResolvedValue(undefined),
    loadCloudinaryConfiguration: vi.fn().mockReturnValue({
      cloudName: 'test-cloud',
      accountIdentity: 'test-account',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    } satisfies ArtworkMigrationCloudinaryConfiguration),
    verifyCloudinaryIdentity: vi.fn().mockResolvedValue(undefined),
    openJournal: vi.fn().mockResolvedValue(undefined),
  };
}

async function createSignedFixture(
  changes: Partial<ArtworkMigrationAuthorizationPayload> = {},
): Promise<{
  environment: NodeJS.ProcessEnv;
  payload: ArtworkMigrationAuthorizationPayload;
}> {
  const rootCertificate = rootCertificates[0];
  if (!rootCertificate)
    throw new Error('Node root certificate fixture missing');

  const caPath = path.join(fixtureRoot, 'migration-ca.pem');
  const manifestPath = path.join(fixtureRoot, 'authorization.json');
  const publicKeyPath = path.join(fixtureRoot, 'authorization.pub');
  const keyPair = generateKeyPairSync('ed25519');
  const privateKey = keyPair.privateKey;
  await writeFile(caPath, rootCertificate);
  await writeFile(
    publicKeyPath,
    keyPair.publicKey.export({ type: 'spki', format: 'pem' }),
  );

  const payload = makePayload(changes);
  const signature = sign(
    null,
    Buffer.from(getArtworkMigrationManifestSigningBytes(1, payload)),
    privateKey,
  ).toString('base64url');
  await writeFile(
    manifestPath,
    JSON.stringify({ version: 1, payload, signature }),
  );
  const credentialPath = path.join(fixtureRoot, 'migration-credential.json');
  return {
    payload,
    environment: {
      ARTWORK_MIGRATION_MONGODB_URI:
        'mongodb://127.0.0.1:27017/dainty_bloom_isolated',
      ARTWORK_MIGRATION_DEPLOYMENT_ID: 'isolated-test-deployment',
      ARTWORK_MIGRATION_DATABASE_NAME: 'dainty_bloom_isolated',
      ARTWORK_MIGRATION_DATABASE_ROLE: 'artwork_migration',
      ARTWORK_MIGRATION_TLS_SERVER_HOSTNAME: 'mongo.test.invalid',
      ARTWORK_MIGRATION_TLS_CA_FILE: caPath,
      ARTWORK_MIGRATION_AUTHORIZATION_MANIFEST_FILE: manifestPath,
      ARTWORK_MIGRATION_AUTHORIZATION_PUBLIC_KEY_FILE: publicKeyPath,
      ARTWORK_MIGRATION_RUN_ID: 'c0a80123-4567-489a-bcde-123456789abc',
      ARTWORK_MIGRATION_AUTHORIZATION_EXPIRES_AT: payload.expiresAt,
      ARTWORK_MIGRATION_OPERATION: 'artwork_migration_dry_run',
      ARTWORK_MIGRATION_MONGODB_CREDENTIAL_REF:
        pathToFileURL(credentialPath).toString(),
      ARTWORK_MIGRATION_SOURCE_PRIVATE_DIR: path.join(fixtureRoot, 'artwork'),
      ARTWORK_MIGRATION_UPLOAD_MAX_BYTES: '1048576',
    },
  };
}

function makePayload(
  changes: Partial<ArtworkMigrationAuthorizationPayload> = {},
): ArtworkMigrationAuthorizationPayload {
  const deploymentIdentity =
    changes.deploymentIdentity ?? 'isolated-test-deployment';
  const databaseName = changes.databaseName ?? 'dainty_bloom_isolated';
  return {
    deploymentIdentity,
    databaseName,
    databaseRole: 'artwork_migration',
    tlsServerHostname: changes.tlsServerHostname ?? 'mongo.test.invalid',
    runId: changes.runId ?? 'c0a80123-4567-489a-bcde-123456789abc',
    operation: changes.operation ?? 'artwork_migration_dry_run',
    issuedAt: changes.issuedAt ?? '2026-03-01T11:00:00.000Z',
    expiresAt: changes.expiresAt ?? '2026-03-01T13:00:00.000Z',
    identityMarker: {
      collection: '_migrationIdentity',
      id: 'artwork-migration',
      deploymentIdentity,
      databaseName,
      markerVersion: 1,
    },
  };
}
