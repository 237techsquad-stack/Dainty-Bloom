import mongoose, {
  type Connection,
  type Model,
  type ConnectOptions,
} from 'mongoose';

import type {
  ArtworkMigrationAuthorizationPayload,
  ArtworkMigrationConfiguration,
  ArtworkMigrationMongoCredential,
} from './artworkMigrationAuthorization';
import { ArtworkMigrationAuthorizationError } from './artworkMigrationAuthorization';
import {
  ARTWORK_ASSET_COLLECTION_NAME,
  artworkAssetSchema,
  type IArtworkAsset,
} from '../models/ArtworkAssetSchema';

const MIGRATION_IDENTITY_COLLECTION = '_migrationIdentity';
const MIGRATION_IDENTITY_ID = 'artwork-migration';

export function buildArtworkMigrationConnectionOptions(
  configuration: ArtworkMigrationConfiguration,
  credential: ArtworkMigrationMongoCredential,
): ConnectOptions {
  return {
    auth: {
      username: credential.username,
      password: credential.password,
    },
    authSource: credential.authSource,
    authMechanism: 'SCRAM-SHA-256',
    directConnection: true,
    tls: true,
    tlsCAFile: configuration.tlsCaFile,
    tlsAllowInvalidCertificates: false,
    tlsAllowInvalidHostnames: false,
    tlsInsecure: false,
    servername: configuration.tlsServerHostname,
    dbName: configuration.databaseName,
    autoCreate: false,
    autoIndex: false,
    bufferCommands: false,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  };
}

export async function connectArtworkMigrationDatabase(
  configuration: ArtworkMigrationConfiguration,
  credential: ArtworkMigrationMongoCredential,
): Promise<Connection> {
  const connection = mongoose.createConnection(
    configuration.mongoUri,
    buildArtworkMigrationConnectionOptions(configuration, credential),
  );
  try {
    await connection.asPromise();
    return connection;
  } catch {
    await connection.close().catch(() => undefined);
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_DATABASE_CONNECTION_FAILED',
    );
  }
}

export async function verifyArtworkMigrationDatabaseIdentity(
  connection: Connection,
  configuration: ArtworkMigrationConfiguration,
  authorization: ArtworkMigrationAuthorizationPayload,
  credential: ArtworkMigrationMongoCredential,
): Promise<void> {
  assertArtworkMigrationAuthorizationCurrent(configuration, authorization);
  const database = connection.db;
  if (
    connection.readyState !== 1 ||
    connection.name !== configuration.databaseName ||
    !database ||
    database.databaseName !== configuration.databaseName
  ) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CONNECTED_DATABASE_MISMATCH',
    );
  }

  let hello: unknown;
  try {
    hello = await database.admin().command({ hello: 1 });
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CONNECTED_TOPOLOGY_UNVERIFIABLE',
    );
  }
  assertArtworkMigrationTopology(hello);

  let connectionStatus: unknown;
  try {
    connectionStatus = await database
      .admin()
      .command({ connectionStatus: 1, showPrivileges: true });
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_DATABASE_PERMISSIONS_UNVERIFIABLE',
    );
  }
  assertArtworkMigrationDatabasePermissions(
    connectionStatus,
    configuration,
    credential,
  );

  let marker: unknown;
  try {
    marker = await database
      .collection<{
        _id: string;
        deploymentIdentity: string;
        databaseName: string;
        markerVersion: number;
      }>(MIGRATION_IDENTITY_COLLECTION)
      .findOne({ _id: MIGRATION_IDENTITY_ID });
  } catch {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_IDENTITY_MARKER_UNAVAILABLE',
    );
  }
  assertArtworkMigrationIdentityMarker(marker, authorization);
  assertArtworkMigrationAuthorizationCurrent(configuration, authorization);
}

export function assertArtworkMigrationDatabasePermissions(
  status: unknown,
  configuration: ArtworkMigrationConfiguration,
  credential: ArtworkMigrationMongoCredential,
): void {
  if (!isRecord(status)) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_DATABASE_PERMISSIONS_UNVERIFIABLE',
    );
  }
  const users: unknown = status.authenticatedUsers;
  const roles: unknown = status.authenticatedUserRoles;
  const privileges: unknown = status.authenticatedUserPrivileges;
  if (
    !Array.isArray(users) ||
    !users.some(
      (user) =>
        isRecord(user) &&
        user.user === credential.username &&
        user.db === credential.authSource,
    ) ||
    !Array.isArray(roles) ||
    roles.length !== 1 ||
    !isRecord(roles[0]) ||
    roles[0].role !== configuration.databaseRole ||
    roles[0].db !== configuration.databaseName
  ) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_DATABASE_PERMISSIONS_UNSAFE',
    );
  }
  const expectedPrivileges = new Map([
    [
      `${configuration.databaseName}.${ARTWORK_ASSET_COLLECTION_NAME}`,
      ['find', 'update'],
    ],
    [
      `${configuration.databaseName}.${MIGRATION_IDENTITY_COLLECTION}`,
      ['find'],
    ],
  ]);
  if (!Array.isArray(privileges)) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_DATABASE_PERMISSIONS_UNSAFE',
    );
  }
  const actualPrivileges = new Map<string, Set<string>>();
  for (const privilege of privileges) {
    if (
      !isRecord(privilege) ||
      !isRecord(privilege.resource) ||
      typeof privilege.resource.db !== 'string' ||
      typeof privilege.resource.collection !== 'string' ||
      !Array.isArray(privilege.actions) ||
      !privilege.actions.every((action) => typeof action === 'string')
    ) {
      throw new ArtworkMigrationAuthorizationError(
        'MIGRATION_DATABASE_PERMISSIONS_UNSAFE',
      );
    }
    const resourceKey = `${privilege.resource.db}.${privilege.resource.collection}`;
    const actions = actualPrivileges.get(resourceKey) ?? new Set<string>();
    for (const action of privilege.actions) actions.add(action);
    actualPrivileges.set(resourceKey, actions);
  }
  if (
    actualPrivileges.size !== expectedPrivileges.size ||
    [...expectedPrivileges].some(([resource, expectedActions]) => {
      const actualActions = actualPrivileges.get(resource);
      return (
        !actualActions ||
        actualActions.size !== expectedActions.length ||
        expectedActions.some((action) => !actualActions.has(action))
      );
    })
  ) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_DATABASE_PERMISSIONS_UNSAFE',
    );
  }
}

export function assertArtworkMigrationIdentityMarker(
  marker: unknown,
  authorization: ArtworkMigrationAuthorizationPayload,
): void {
  if (
    !isRecord(marker) ||
    marker._id !== authorization.identityMarker.id ||
    marker.deploymentIdentity !==
      authorization.identityMarker.deploymentIdentity ||
    marker.databaseName !== authorization.identityMarker.databaseName ||
    marker.markerVersion !== authorization.identityMarker.markerVersion
  ) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_IDENTITY_MARKER_MISMATCH',
    );
  }
}

export function assertArtworkMigrationTopology(hello: unknown): void {
  if (!isApprovedStandaloneHello(hello)) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CONNECTED_TOPOLOGY_UNSAFE',
    );
  }
}

export function createArtworkMigrationModel(
  connection: Connection,
): Model<IArtworkAsset> {
  if (connection.readyState !== 1) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_DATABASE_CONNECTION_REQUIRED',
    );
  }
  return connection.model<IArtworkAsset>(
    'ArtworkAsset',
    artworkAssetSchema,
    ARTWORK_ASSET_COLLECTION_NAME,
  );
}

export function assertArtworkMigrationAuthorizationCurrent(
  configuration: ArtworkMigrationConfiguration,
  authorization: ArtworkMigrationAuthorizationPayload,
  now: Date = new Date(),
): void {
  if (
    authorization.deploymentIdentity !== configuration.deploymentIdentity ||
    authorization.databaseName !== configuration.databaseName ||
    authorization.tlsServerHostname !== configuration.tlsServerHostname ||
    authorization.runId !== configuration.runId ||
    authorization.operation !== configuration.operation ||
    new Date(authorization.expiresAt).toISOString() !==
      configuration.expiresAt ||
    Date.parse(authorization.expiresAt) <= now.getTime() ||
    Date.parse(authorization.issuedAt) > now.getTime() + 60_000
  ) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_AUTHORIZATION_EXPIRED_OR_INVALID',
    );
  }
}

function isApprovedStandaloneHello(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const noMembers = (field: string): boolean => {
    const members = value[field];
    return (
      members === undefined || (Array.isArray(members) && members.length === 0)
    );
  };
  return (
    value.isWritablePrimary === true &&
    value.setName === undefined &&
    value.msg !== 'isdbgrid' &&
    value.serviceId === undefined &&
    noMembers('hosts') &&
    noMembers('passives') &&
    noMembers('arbiters')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
