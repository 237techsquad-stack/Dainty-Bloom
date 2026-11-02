import type { ArtworkMigrationTarget } from './artworkMigrationJournal';
import mongoose, { type Connection } from 'mongoose';
import { env } from '../config/env';

export interface ArtworkMigrationArguments {
  dryRun: boolean;
  confirmation?: string;
}

export function parseArtworkMigrationCliMode(args: string[]): {
  dryRun: true;
} {
  if (args.includes('--write')) {
    throw new Error('MIGRATION_WRITE_DISABLED_PENDING_IDENTITY_DESIGN');
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) {
    throw new Error('MIGRATION_ARGUMENTS_INVALID');
  }
  return { dryRun: true };
}

export function describeArtworkMigrationTarget(
  mongoUri: string,
  environment: string,
): ArtworkMigrationTarget {
  let uri: URL;
  try {
    uri = new URL(mongoUri);
  } catch {
    throw new Error('MIGRATION_TARGET_INVALID');
  }
  if (
    !['mongodb:', 'mongodb+srv:'].includes(uri.protocol) ||
    !uri.hostname ||
    uri.pathname.length < 2
  ) {
    throw new Error('MIGRATION_TARGET_INVALID');
  }
  let database: string;
  try {
    database = decodeURIComponent(uri.pathname.slice(1).split('/')[0] ?? '');
  } catch {
    throw new Error('MIGRATION_TARGET_INVALID');
  }
  if (!database || /[\r\n]/.test(database)) {
    throw new Error('MIGRATION_TARGET_INVALID');
  }
  if (/[\\/?#]/.test(database)) {
    throw new Error('MIGRATION_TARGET_INVALID');
  }
  return {
    environment,
    host: uri.host.toLowerCase(),
    database,
  };
}

export function assertArtworkMigrationTargetIsLocal(
  target: ArtworkMigrationTarget,
): void {
  if (target.environment === 'production') {
    throw new Error('PRODUCTION_MIGRATION_DISABLED');
  }
  if (target.environment !== 'development') {
    throw new Error('MIGRATION_REQUIRES_DEVELOPMENT_ENVIRONMENT');
  }
  const hostname = target.host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('MIGRATION_REQUIRES_LOOPBACK_DATABASE');
  }
}

export function assertArtworkMigrationWriteConfirmed(
  target: ArtworkMigrationTarget,
  confirmation: string | undefined,
): void {
  if (confirmation !== getArtworkMigrationTargetIdentifier(target)) {
    throw new Error('MIGRATION_CONFIRMATION_REQUIRED');
  }
}

export function assertArtworkMigrationRuntimeTarget(
  target: ArtworkMigrationTarget,
  confirmation: string | undefined,
  connection: Connection = mongoose.connection,
  dryRun = false,
): void {
  if (env.NODE_ENV !== 'development') {
    throw new Error('MIGRATION_REQUIRES_DEVELOPMENT_ENVIRONMENT');
  }
  const runtimeTarget = describeArtworkMigrationTarget(
    env.MONGODB_URI,
    env.NODE_ENV,
  );
  assertArtworkMigrationTargetIsLocal(runtimeTarget);
  if (!sameTarget(target, runtimeTarget)) {
    throw new Error('MIGRATION_RUNTIME_TARGET_MISMATCH');
  }
  if (!dryRun) {
    assertArtworkMigrationWriteConfirmed(runtimeTarget, confirmation);
    throw new Error('MIGRATION_WRITE_DISABLED_PENDING_IDENTITY_DESIGN');
  }
  assertConnectedArtworkMigrationTargetIsLocal(runtimeTarget, connection);
}

export function assertConnectedArtworkMigrationTargetIsLocal(
  target: ArtworkMigrationTarget,
  connection: Connection = mongoose.connection,
): void {
  assertArtworkMigrationTargetIsLocal(target);
  if (connection.readyState !== 1) {
    throw new Error('MIGRATION_CONNECTED_DATABASE_UNVERIFIABLE');
  }

  let client: ReturnType<Connection['getClient']>;
  try {
    client = connection.getClient();
  } catch {
    throw new Error('MIGRATION_CONNECTED_TOPOLOGY_UNVERIFIABLE');
  }
  let connectedDatabase: string;
  try {
    connectedDatabase = client.db().databaseName;
  } catch {
    throw new Error('MIGRATION_CONNECTED_DATABASE_UNVERIFIABLE');
  }
  if (connectedDatabase !== target.database) {
    throw new Error('MIGRATION_CONNECTED_DATABASE_UNVERIFIABLE');
  }
  const topologyDescriptor = Object.getOwnPropertyDescriptor(
    client,
    'topology',
  );
  const topology: unknown = topologyDescriptor?.value;
  if (!isRecord(topology)) {
    throw new Error('MIGRATION_CONNECTED_TOPOLOGY_UNVERIFIABLE');
  }
  const description: unknown = Reflect.get(topology, 'description');
  if (!isRecord(description) || Reflect.get(description, 'type') !== 'Single') {
    throw new Error('MIGRATION_CONNECTED_TOPOLOGY_UNSAFE');
  }
  const servers: unknown = Reflect.get(description, 'servers');
  if (!(servers instanceof Map) || servers.size !== 1) {
    throw new Error('MIGRATION_CONNECTED_TOPOLOGY_UNSAFE');
  }
  const [serverEntry] = servers.entries();
  const [connectedAddress, serverDescription] = serverEntry ?? [];
  if (
    typeof connectedAddress !== 'string' ||
    !sameLoopbackAddress(target.host, connectedAddress) ||
    !isStandaloneServerDescription(serverDescription, connectedAddress)
  ) {
    throw new Error('MIGRATION_CONNECTED_SERVER_UNSAFE');
  }
  const options: unknown = client.options;
  if (
    !isRecord(options) ||
    (Reflect.get(options, 'directConnection') !== undefined &&
      typeof Reflect.get(options, 'directConnection') !== 'boolean') ||
    (Reflect.get(options, 'loadBalanced') !== undefined &&
      typeof Reflect.get(options, 'loadBalanced') !== 'boolean') ||
    (Reflect.get(options, 'replicaSet') !== undefined &&
      typeof Reflect.get(options, 'replicaSet') !== 'string')
  ) {
    throw new Error('MIGRATION_CONNECTED_TOPOLOGY_UNVERIFIABLE');
  }
  if (
    Reflect.get(options, 'replicaSet') !== undefined ||
    Reflect.get(options, 'loadBalanced') === true
  ) {
    throw new Error('MIGRATION_CONNECTED_TOPOLOGY_UNSAFE');
  }
}

export function parseArtworkMigrationArguments(
  args: string[],
  target: ArtworkMigrationTarget,
): ArtworkMigrationArguments {
  let write = false;
  let dryRun = false;
  let confirmation: string | undefined;
  for (const arg of args) {
    if (arg === '--write') {
      if (write) throw new Error('MIGRATION_ARGUMENTS_INVALID');
      write = true;
    } else if (arg === '--dry-run') {
      if (dryRun) throw new Error('MIGRATION_ARGUMENTS_INVALID');
      dryRun = true;
    } else if (arg.startsWith('--confirm-target=')) {
      if (confirmation !== undefined) {
        throw new Error('MIGRATION_ARGUMENTS_INVALID');
      }
      confirmation = arg.slice('--confirm-target='.length);
    } else {
      throw new Error('MIGRATION_ARGUMENTS_INVALID');
    }
  }
  if (write && dryRun) {
    throw new Error('MIGRATION_ARGUMENTS_INVALID');
  }
  if (write) {
    if (confirmation !== getArtworkMigrationTargetIdentifier(target)) {
      throw new Error('MIGRATION_CONFIRMATION_REQUIRED');
    }
  } else if (confirmation !== undefined) {
    throw new Error('MIGRATION_CONFIRMATION_WITHOUT_WRITE');
  }
  if (write) {
    throw new Error('MIGRATION_WRITE_DISABLED_PENDING_IDENTITY_DESIGN');
  }
  return { dryRun: !write, ...(confirmation ? { confirmation } : {}) };
}

export function getArtworkMigrationTargetIdentifier(
  target: ArtworkMigrationTarget,
): string {
  return `${target.environment}@${target.host}/${target.database}`;
}

function sameLoopbackAddress(expected: string, actual: string): boolean {
  const expectedParts = parseAddress(expected);
  const actualParts = parseAddress(actual);
  const loopbacks = new Set(['localhost', '127.0.0.1', '::1']);
  return (
    expectedParts !== undefined &&
    actualParts !== undefined &&
    loopbacks.has(expectedParts.hostname) &&
    loopbacks.has(actualParts.hostname) &&
    expectedParts.port === actualParts.port
  );
}

function isStandaloneServerDescription(
  value: unknown,
  connectedAddress: string,
): boolean {
  if (!isRecord(value)) return false;
  const emptyList = (field: string): boolean => {
    const list: unknown = Reflect.get(value, field);
    return Array.isArray(list) && list.length === 0;
  };
  return (
    Reflect.get(value, 'type') === 'Standalone' &&
    Reflect.get(value, 'address') === connectedAddress &&
    Reflect.get(value, 'setName') === null &&
    emptyList('hosts') &&
    emptyList('passives') &&
    emptyList('arbiters')
  );
}

function sameTarget(
  left: ArtworkMigrationTarget,
  right: ArtworkMigrationTarget,
): boolean {
  return (
    left.environment === right.environment &&
    left.host === right.host &&
    left.database === right.database
  );
}

function parseAddress(
  address: string,
): { hostname: string; port: string } | undefined {
  const match = /^(?:\[([^\]]+)\]|([^:]+))(?::(\d+))?$/.exec(address);
  const hostname = (match?.[1] ?? match?.[2])?.toLowerCase();
  const port = match?.[3] ?? '27017';
  return hostname && port ? { hostname, port } : undefined;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}
