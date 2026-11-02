import { XMLValidator } from 'fast-xml-parser';

import { AppError } from './AppError';
import { detectFileType } from './fileType';

export function validateSvg(buffer: Buffer): void {
  const xml = buffer.toString('utf8');
  const validation = XMLValidator.validate(xml, {
    allowBooleanAttributes: false,
  });
  const unsafe =
    validation !== true ||
    !/<svg(?:\s|>)/i.test(xml) ||
    /<\s*(?:[\w.-]+:)?script\b/i.test(xml) ||
    /<\s*(?:[\w.-]+:)?foreignObject\b/i.test(xml) ||
    /\bon[a-z]+\s*=/i.test(xml) ||
    /\b(?:href|xlink:href)\s*=\s*["'](?!#)[^"']*["']/i.test(xml) ||
    /url\s*\(\s*["']?(?!#)/i.test(xml) ||
    /@import\b/i.test(xml) ||
    /<!ENTITY\b|<!DOCTYPE\b/i.test(xml);
  if (unsafe) throw new AppError('SVG file is not safe', 400, 'FILE_CORRUPT');
}

export async function detectArtworkMime(buffer: Buffer): Promise<string> {
  const text = buffer
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (
    /^(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(text)
  ) {
    validateSvg(buffer);
    return 'image/svg+xml';
  }
  const type = await detectFileType(buffer);
  if (type?.mime) return type.mime;

  throw new AppError('File type could not be detected', 400, 'FILE_CORRUPT');
}
