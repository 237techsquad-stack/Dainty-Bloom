import {
  ArtworkMigrationAuthorizationError,
  type ArtworkMigrationConfiguration,
  type ArtworkMigrationMongoCredential,
  type ArtworkMigrationAuthorizationPayload,
} from './artworkMigrationAuthorization';
import { assertArtworkMigrationAuthorizationCurrent } from './artworkMigrationConnection';
import type { ArtworkMigrationCloudinaryConfiguration } from './artworkMigrationCloudinary';
import type { Connection } from 'mongoose';
import type { ArtworkMigrationTarget } from './artworkMigrationJournal';
import {
  assertArtworkMigrationTargetIsLocal,
  describeArtworkMigrationTarget,
  parseArtworkMigrationCliMode,
} from './artworkMigrationSafety';

export interface ArtworkMigrationPreflightDependencies {
  loadConfiguration(): Promise<ArtworkMigrationConfiguration>;
  verifyAuthorization(
    configuration: ArtworkMigrationConfiguration,
  ): Promise<ArtworkMigrationAuthorizationPayload>;
  resolveCredential(
    reference: string,
    expectedRole: ArtworkMigrationConfiguration['databaseRole'],
  ): Promise<ArtworkMigrationMongoCredential>;
  connect(
    configuration: ArtworkMigrationConfiguration,
    credential: ArtworkMigrationMongoCredential,
  ): Promise<Connection>;
  verifyDatabaseIdentity(
    connection: Connection,
    configuration: ArtworkMigrationConfiguration,
    authorization: ArtworkMigrationAuthorizationPayload,
    credential: ArtworkMigrationMongoCredential,
  ): Promise<void>;
  loadCloudinaryConfiguration(): ArtworkMigrationCloudinaryConfiguration;
  verifyCloudinaryIdentity(
    configuration: ArtworkMigrationCloudinaryConfiguration,
  ): Promise<void>;
  openJournal(
    target: ArtworkMigrationTarget,
    configuration: ArtworkMigrationConfiguration,
  ): Promise<void>;
}

export async function runArtworkMigrationPreflight(
  args: string[],
  dependencies: ArtworkMigrationPreflightDependencies,
): Promise<void> {
  const mode = parseArtworkMigrationCliMode(args);
  const configuration = await dependencies.loadConfiguration();
  if (configuration.operation !== 'artwork_migration_dry_run') {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_WRITE_DISABLED_PENDING_IDENTITY_DESIGN',
    );
  }
  const authorization = await dependencies.verifyAuthorization(configuration);
  if (
    !mode.dryRun ||
    authorization.operation !== 'artwork_migration_dry_run' ||
    configuration.operation !== 'artwork_migration_dry_run'
  ) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_WRITE_DISABLED_PENDING_IDENTITY_DESIGN',
    );
  }

  const target = describeArtworkMigrationTarget(
    configuration.mongoUri,
    'development',
  );
  assertArtworkMigrationTargetIsLocal(target);
  const credential = await dependencies.resolveCredential(
    configuration.credentialReference,
    configuration.databaseRole,
  );
  const connection = await dependencies.connect(configuration, credential);
  try {
    await dependencies.verifyDatabaseIdentity(
      connection,
      configuration,
      authorization,
      credential,
    );
    assertArtworkMigrationAuthorizationCurrent(configuration, authorization);
    const cloudinaryConfiguration = dependencies.loadCloudinaryConfiguration();
    await dependencies.verifyCloudinaryIdentity(cloudinaryConfiguration);
    assertArtworkMigrationAuthorizationCurrent(configuration, authorization);
    await dependencies.openJournal(target, configuration);
  } finally {
    await connection.close();
  }
}
