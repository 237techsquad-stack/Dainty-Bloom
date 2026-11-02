import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('About media sizing', () => {
  it('keeps video and poster content within the fixed gallery frame without changing its aspect ratio', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/styles/storefront.css'),
      'utf8',
    );
    expect(styles).toMatch(
      /\.about-media__visual\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/,
    );
    expect(styles).toMatch(
      /\.about-media__visual video\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;/,
    );
    expect(styles).not.toMatch(
      /\.about-media__visual video\s*\{[^}]*object-fit:\s*cover;/,
    );
    expect(styles).toMatch(
      /\.about-media__visual img,\s*\.about-media__visual video\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/,
    );
  });
});
