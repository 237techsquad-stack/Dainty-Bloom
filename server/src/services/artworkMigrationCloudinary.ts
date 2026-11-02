import { z } from 'zod';

import { ArtworkMigrationAuthorizationError } from './artworkMigrationAuthorization';

const migrationCloudinarySchema = z
  .object({
    ARTWORK_MIGRATION_CLOUDINARY_CLOUD_NAME: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9_-]+$/),
    ARTWORK_MIGRATION_CLOUDINARY_ACCOUNT_ID: z.string().min(1).max(255),
    ARTWORK_MIGRATION_CLOUDINARY_API_KEY: z.string().min(1),
    ARTWORK_MIGRATION_CLOUDINARY_API_SECRET: z.string().min(1),
  })
  .strict();

export interface ArtworkMigrationCloudinaryConfiguration {
  cloudName: string;
  accountIdentity: string;
  apiKey: string;
  apiSecret: string;
}

export function loadArtworkMigrationCloudinaryConfiguration(
  source: NodeJS.ProcessEnv = process.env,
): ArtworkMigrationCloudinaryConfiguration {
  const parsed = migrationCloudinarySchema.safeParse({
    ARTWORK_MIGRATION_CLOUDINARY_CLOUD_NAME:
      source.ARTWORK_MIGRATION_CLOUDINARY_CLOUD_NAME,
    ARTWORK_MIGRATION_CLOUDINARY_ACCOUNT_ID:
      source.ARTWORK_MIGRATION_CLOUDINARY_ACCOUNT_ID,
    ARTWORK_MIGRATION_CLOUDINARY_API_KEY:
      source.ARTWORK_MIGRATION_CLOUDINARY_API_KEY,
    ARTWORK_MIGRATION_CLOUDINARY_API_SECRET:
      source.ARTWORK_MIGRATION_CLOUDINARY_API_SECRET,
  });
  if (!parsed.success) {
    throw new ArtworkMigrationAuthorizationError(
      'MIGRATION_CLOUDINARY_CONFIGURATION_INVALID',
    );
  }
  return {
    cloudName: parsed.data.ARTWORK_MIGRATION_CLOUDINARY_CLOUD_NAME,
    accountIdentity: parsed.data.ARTWORK_MIGRATION_CLOUDINARY_ACCOUNT_ID,
    apiKey: parsed.data.ARTWORK_MIGRATION_CLOUDINARY_API_KEY,
    apiSecret: parsed.data.ARTWORK_MIGRATION_CLOUDINARY_API_SECRET,
  };
}

export async function verifyArtworkMigrationCloudinaryIdentity(
  _configuration: ArtworkMigrationCloudinaryConfiguration,
): Promise<never> {
  throw new ArtworkMigrationAuthorizationError(
    'MIGRATION_CLOUDINARY_ACCOUNT_IDENTITY_UNVERIFIABLE',
  );
}
