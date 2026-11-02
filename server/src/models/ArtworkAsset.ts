import { model, models, type Model } from 'mongoose';

import { artworkAssetSchema, type IArtworkAsset } from './ArtworkAssetSchema';

export { artworkAssetSchema, type IArtworkAsset } from './ArtworkAssetSchema';

export const ArtworkAsset: Model<IArtworkAsset> =
  (models.ArtworkAsset as Model<IArtworkAsset> | undefined) ??
  model<IArtworkAsset>('ArtworkAsset', artworkAssetSchema);
