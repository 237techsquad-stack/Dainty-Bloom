interface DetectedFileType {
  mime: string;
}

interface FileTypeModule {
  fileTypeFromBuffer(buffer: Buffer): Promise<DetectedFileType | undefined>;
}

// Preserve native import so the ESM-only file-type package works in this CommonJS build.
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<FileTypeModule>;

export async function detectFileType(
  buffer: Buffer,
): Promise<DetectedFileType | undefined> {
  const fileType = await importEsm('file-type');
  return fileType.fileTypeFromBuffer(buffer);
}
