import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

export const ARTWORK_MIGRATION_PHASES = [
  'discovered',
  'source_validated',
  'upload_started',
  'cloudinary_upload_confirmed',
  'provider_metadata_verified',
  'sha256_verified',
  'database_record_updated',
  'complete',
  'failed',
  'requires_reconciliation',
] as const;

export type ArtworkMigrationPhase = (typeof ARTWORK_MIGRATION_PHASES)[number];

export interface ArtworkMigrationTarget {
  environment: string;
  host: string;
  database: string;
}

export interface ArtworkMigrationJournalEntry {
  artworkId: string;
  attemptId?: string;
  sourceKey: string;
  sourceChecksum: string;
  targetKey: string;
  phase: ArtworkMigrationPhase;
  updatedAt: string;
  failureCode?: string;
}

export interface ArtworkMigrationJournal {
  version: 1;
  target: ArtworkMigrationTarget;
  entries: Record<string, ArtworkMigrationJournalEntry>;
}

export interface ArtworkMigrationJournalRepository {
  load(target: ArtworkMigrationTarget): Promise<ArtworkMigrationJournal>;
  withMigrationLock<T>(action: () => Promise<T>): Promise<T>;
  save(
    journal: ArtworkMigrationJournal,
    changedArtworkId?: string,
  ): Promise<void>;
}

const journalHeaderSchema = z
  .object({
    type: z.literal('header'),
    version: z.literal(1),
    target: z
      .object({
        environment: z.string().min(1),
        host: z.string().min(1),
        database: z.string().min(1),
      })
      .strict(),
  })
  .strict();
const journalEntrySchema = z
  .object({
    type: z.literal('entry'),
    entry: z
      .object({
        artworkId: z.string().min(1),
        attemptId: z.string().uuid().optional(),
        sourceKey: z.string().min(1),
        sourceChecksum: z.string().min(1),
        targetKey: z.string().min(1),
        phase: z.enum(ARTWORK_MIGRATION_PHASES),
        updatedAt: z.string().datetime(),
        failureCode: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

interface ParsedJournal {
  journal: ArtworkMigrationJournal;
  validContent: string;
  needsRecovery: boolean;
}

export class FileArtworkMigrationJournal implements ArtworkMigrationJournalRepository {
  private persistedTarget?: ArtworkMigrationTarget;

  constructor(
    private readonly filePath: string,
    private readonly replaceFile: typeof rename = rename,
  ) {}

  async load(target: ArtworkMigrationTarget): Promise<ArtworkMigrationJournal> {
    try {
      const parsed = await readAndParseJournal(this.filePath, target);
      this.persistedTarget = target;
      return structuredClone(parsed.journal);
    } catch (error) {
      if (error instanceof ArtworkMigrationJournalError) throw error;
      if (isNodeError(error) && error.code === 'ENOENT') {
        await assertSafeJournalParent(path.dirname(this.filePath));
        this.persistedTarget = target;
        return { version: 1, target, entries: {} };
      }
      throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
    }
  }

  async save(
    journal: ArtworkMigrationJournal,
    changedArtworkId?: string,
  ): Promise<void> {
    if (
      !this.persistedTarget ||
      !sameTarget(this.persistedTarget, journal.target)
    ) {
      throw new ArtworkMigrationJournalError('JOURNAL_TARGET_MISMATCH');
    }

    await mkdir(path.dirname(this.filePath), {
      recursive: true,
      mode: 0o700,
    }).catch(() => {
      throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
    });
    await assertSafeJournalParent(path.dirname(this.filePath));

    await withJournalWriteLock(this.filePath, async () => {
      const diskState = await readCurrentJournal(this.filePath, journal.target);
      if (diskState.needsRecovery) {
        await recoverJournal(
          this.filePath,
          diskState.validContent,
          this.replaceFile,
        );
      }

      const eventsToSave = changedArtworkId
        ? [[changedArtworkId, journal.entries[changedArtworkId]] as const]
        : Object.entries(journal.entries);
      const changedEntries = eventsToSave.filter(([id, entry]) => {
        if (entry === undefined) return false;
        const current = diskState.journal.entries[id];
        return (
          JSON.stringify(current) !== JSON.stringify(entry) &&
          !isDuplicateProgress(current, entry)
        );
      });
      for (const [id, entry] of changedEntries) {
        if (id !== entry.artworkId) {
          throw new ArtworkMigrationJournalError('JOURNAL_CORRUPT');
        }
        assertJournalTransition(diskState.journal.entries[id], entry);
      }

      let content = diskState.validContent;
      if (!content) {
        content = `${JSON.stringify({
          type: 'header',
          version: 1,
          target: journal.target,
        })}\n`;
      } else if (!content.endsWith('\n')) {
        content += '\n';
      }
      if (changedEntries.length > 0) {
        const events = changedEntries
          .map(([, entry]) => JSON.stringify({ type: 'entry', entry }))
          .join('\n');
        content += `${events}\n`;
      }
      if (content !== diskState.validContent) {
        await appendAndSync(
          this.filePath,
          content.slice(diskState.validContent.length),
        );
      }

      this.persistedTarget = journal.target;
    }).catch((error: unknown) => {
      if (error instanceof ArtworkMigrationJournalError) throw error;
      throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
    });
  }

  async withMigrationLock<T>(action: () => Promise<T>): Promise<T> {
    return withJournalRunLock(this.filePath, action);
  }
}

async function readCurrentJournal(
  filePath: string,
  target: ArtworkMigrationTarget,
): Promise<ParsedJournal> {
  try {
    return await readAndParseJournal(filePath, target);
  } catch (error) {
    if (error instanceof ArtworkMigrationJournalError) throw error;
    if (isNodeError(error) && error.code === 'ENOENT') {
      await assertSafeJournalParent(path.dirname(filePath));
      return {
        journal: { version: 1, target, entries: {} },
        validContent: '',
        needsRecovery: false,
      };
    }
    throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
  }
}

async function readAndParseJournal(
  filePath: string,
  target: ArtworkMigrationTarget,
): Promise<ParsedJournal> {
  const fileInfo = await lstat(filePath);
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
  }
  const content = await readFile(filePath, 'utf8');
  const terminated = content.endsWith('\n');
  const lines = content.split('\n');
  if (terminated) lines.pop();
  if (lines.length === 0 || !lines[0]) {
    throw new ArtworkMigrationJournalError('JOURNAL_CORRUPT');
  }
  const header = parseCompleteLine(lines[0], journalHeaderSchema);
  if (!sameTarget(header.target, target)) {
    throw new ArtworkMigrationJournalError('JOURNAL_TARGET_MISMATCH');
  }
  if (!terminated && lines.length === 1) {
    throw new ArtworkMigrationJournalError('JOURNAL_CORRUPT');
  }

  const entries: Record<string, ArtworkMigrationJournalEntry> = {};
  const lastIndex = lines.length - 1;
  let validContent = `${lines[0]}\n`;
  let needsRecovery = false;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.length === 0) {
      throw new ArtworkMigrationJournalError('JOURNAL_CORRUPT');
    }
    const parsedJson = tryParseJson(line);
    const event = journalEntrySchema.safeParse(parsedJson);
    if (event.success) {
      entries[event.data.entry.artworkId] = event.data.entry;
      validContent += `${line}\n`;
      continue;
    }
    const isUnterminatedTail = !terminated && index === lastIndex;
    if (isUnterminatedTail && isDemonstrablyIncompleteEntry(line)) {
      needsRecovery = true;
      continue;
    }
    throw new ArtworkMigrationJournalError('JOURNAL_CORRUPT');
  }

  if (!terminated && !needsRecovery) {
    needsRecovery = true;
  }
  return {
    journal: { version: 1, target, entries },
    validContent,
    needsRecovery,
  };
}

function parseCompleteLine<TSchema extends z.ZodType>(
  line: string,
  schema: TSchema,
): z.output<TSchema> {
  const parsed = schema.safeParse(tryParseJson(line));
  if (!parsed.success) {
    throw new ArtworkMigrationJournalError('JOURNAL_CORRUPT');
  }
  return parsed.data;
}

function tryParseJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function isDemonstrablyIncompleteEntry(line: string): boolean {
  const cursor = new JournalEventPrefixCursor(line);
  if (!cursor.literal('{"type":')) return cursor.incomplete;
  const type = cursor.string('entry');
  if (!type.valid) return false;
  if (!type.complete) return true;
  if (!cursor.literal(',"entry":{')) return cursor.incomplete;

  const fields: Array<{
    key: string;
    validate?: (value: string) => boolean;
    allowedPrefixes?: string[];
    validatePrefix?: (value: string) => boolean;
    optional?: boolean;
  }> = [
    { key: 'artworkId' },
    {
      key: 'attemptId',
      optional: true,
      validate: (value) => z.string().uuid().safeParse(value).success,
      validatePrefix: (value) =>
        /^[0-9a-f]{0,8}(?:-[0-9a-f]{0,4}(?:-[0-9a-f]{0,4}(?:-[0-9a-f]{0,4}(?:-[0-9a-f]{0,12})?)?)?)?$/i.test(
          value,
        ),
    },
    { key: 'sourceKey' },
    { key: 'sourceChecksum' },
    { key: 'targetKey' },
    {
      key: 'phase',
      validate: (value) =>
        ARTWORK_MIGRATION_PHASES.includes(value as ArtworkMigrationPhase),
      allowedPrefixes: [...ARTWORK_MIGRATION_PHASES],
    },
    {
      key: 'updatedAt',
      validate: (value) => z.string().datetime().safeParse(value).success,
      validatePrefix: isIsoDateTimePrefix,
    },
  ];

  let requiredFieldIndex = 0;
  for (const field of fields) {
    if (field.optional) {
      if (cursor.atEnd) return true;
      const marker = `,"${field.key}":`;
      if (!cursor.startsWith(marker)) {
        if (marker.startsWith(cursor.remaining)) return true;
        continue;
      }
    } else if (requiredFieldIndex > 0 && !cursor.literal(',')) {
      return cursor.incomplete;
    }
    if (field.optional || requiredFieldIndex > 0) {
      if (field.optional && !cursor.literal(',')) return cursor.incomplete;
    }
    const key = cursor.string(field.key);
    if (!key.valid) return false;
    if (!key.complete) return true;
    if (!cursor.literal(':')) return cursor.incomplete;
    const value = cursor.string(
      undefined,
      field.validate,
      field.allowedPrefixes,
      field.validatePrefix,
    );
    if (!value.valid) return false;
    if (!value.complete) return true;
    if (!value.value) return false;
    if (!field.optional) requiredFieldIndex += 1;
  }

  if (cursor.atEnd) return true;
  if (cursor.startsWith(',')) {
    if (!cursor.literal(',"failureCode":')) return cursor.incomplete;
    const failureCode = cursor.string();
    if (!failureCode.valid) return false;
    if (!failureCode.complete) return true;
    if (!failureCode.value) return false;
  }
  if (!cursor.literal('}}')) return cursor.incomplete;
  return false;
}

class JournalEventPrefixCursor {
  private offset = 0;
  incomplete = false;

  constructor(private readonly input: string) {}

  get atEnd(): boolean {
    return this.offset === this.input.length;
  }

  get remaining(): string {
    return this.input.slice(this.offset);
  }

  startsWith(value: string): boolean {
    return this.input.startsWith(value, this.offset);
  }

  literal(value: string): boolean {
    const remaining = this.input.slice(this.offset);
    if (value.startsWith(remaining)) {
      this.offset = this.input.length;
      this.incomplete = true;
      return false;
    }
    if (!remaining.startsWith(value)) return false;
    this.offset += value.length;
    return true;
  }

  string(
    expected?: string,
    validate?: (value: string) => boolean,
    allowedPrefixes?: string[],
    validatePrefix?: (value: string) => boolean,
  ): {
    valid: boolean;
    complete: boolean;
    value: string;
  } {
    if (this.atEnd) {
      this.incomplete = true;
      return { valid: true, complete: false, value: '' };
    }
    if (this.input[this.offset] !== '"') {
      return { valid: false, complete: false, value: '' };
    }
    this.offset += 1;
    let value = '';
    let escaped = false;
    let unicodeDigits = '';
    while (this.offset < this.input.length) {
      const character = this.input[this.offset] ?? '';
      this.offset += 1;
      if (unicodeDigits.length > 0) {
        if (!/[0-9a-f]/i.test(character)) {
          return { valid: false, complete: false, value };
        }
        unicodeDigits += character;
        if (unicodeDigits.length === 4) {
          value += String.fromCharCode(parseInt(unicodeDigits, 16));
          unicodeDigits = '';
        }
        continue;
      }
      if (escaped) {
        escaped = false;
        if (character === 'u') {
          unicodeDigits = '';
          continue;
        }
        const escapedValues: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        };
        const decoded = escapedValues[character];
        if (decoded === undefined) {
          return { valid: false, complete: false, value };
        }
        value += decoded;
        continue;
      }
      if (character === '"') {
        const valid =
          (expected === undefined || value === expected) &&
          (validate === undefined || validate(value)) &&
          (allowedPrefixes === undefined || allowedPrefixes.includes(value));
        return { valid, complete: true, value };
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) {
        return { valid: false, complete: false, value };
      }
      value += character;
    }

    const validEscapePrefix =
      !unicodeDigits || /^[0-9a-f]{0,3}$/i.test(unicodeDigits);
    const validExpectedPrefix =
      expected === undefined || expected.startsWith(value);
    const validAllowedPrefix =
      allowedPrefixes === undefined ||
      allowedPrefixes.some((candidate) => candidate.startsWith(value));
    const validSchemaPrefix =
      validatePrefix === undefined || validatePrefix(value);
    const valid =
      validEscapePrefix &&
      validExpectedPrefix &&
      validAllowedPrefix &&
      validSchemaPrefix;
    this.incomplete = valid;
    return { valid, complete: false, value };
  }
}

function isIsoDateTimePrefix(value: string): boolean {
  const match =
    /^(\d{0,4})(?:-(\d{0,2})(?:-(\d{0,2})(?:T(\d{0,2})(?::(\d{0,2})(?::(\d{0,2})(?:\.(\d{0,9}))?)?)?(Z)?)?)?)?$/.exec(
      value,
    );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, fraction] = match;
  if (year === undefined || year.length > 4) return false;
  if (
    (month !== undefined && year.length !== 4) ||
    (day !== undefined && month?.length !== 2) ||
    (hour !== undefined && day?.length !== 2) ||
    (minute !== undefined && hour?.length !== 2) ||
    (second !== undefined && minute?.length !== 2) ||
    (fraction !== undefined && second?.length !== 2)
  ) {
    return false;
  }
  const parsedMonth = month?.length === 2 ? Number(month) : undefined;
  const parsedDay = day?.length === 2 ? Number(day) : undefined;
  if (
    parsedMonth !== undefined &&
    parsedDay !== undefined &&
    (parsedMonth < 1 ||
      parsedMonth > 12 ||
      parsedDay > daysInMonth(Number(year), parsedMonth))
  ) {
    return false;
  }
  return (
    isNumericPrefixInRange(month, 1, 12) &&
    isNumericPrefixInRange(
      day,
      1,
      parsedMonth === undefined ? 31 : daysInMonth(Number(year), parsedMonth),
    ) &&
    isNumericPrefixInRange(hour, 0, 23) &&
    isNumericPrefixInRange(minute, 0, 59) &&
    isNumericPrefixInRange(second, 0, 59) &&
    (fraction === undefined || /^\d{0,9}$/.test(fraction))
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isNumericPrefixInRange(
  value: string | undefined,
  minimum: number,
  maximum: number,
): boolean {
  if (value === undefined || value.length === 0) return true;
  if (value.length > 2 || !/^\d+$/.test(value)) return false;
  if (value.length === 2) {
    const number = Number(value);
    return number >= minimum && number <= maximum;
  }
  return Array.from({ length: maximum - minimum + 1 }, (_, index) =>
    String(minimum + index).padStart(2, '0'),
  ).some((candidate) => candidate.startsWith(value));
}

function isDuplicateProgress(
  current: ArtworkMigrationJournalEntry | undefined,
  proposed: ArtworkMigrationJournalEntry,
): boolean {
  if (!current || current.phase !== proposed.phase) return false;
  return (
    JSON.stringify({ ...current, updatedAt: undefined }) ===
    JSON.stringify({ ...proposed, updatedAt: undefined })
  );
}

function assertJournalTransition(
  current: ArtworkMigrationJournalEntry | undefined,
  proposed: ArtworkMigrationJournalEntry,
): void {
  if (!current) {
    if (proposed.phase !== 'discovered') {
      throw new ArtworkMigrationJournalError('JOURNAL_CORRUPT');
    }
    return;
  }
  if (isDuplicateProgress(current, proposed)) return;

  if (proposed.attemptId !== current.attemptId) {
    if (
      (current.phase !== 'failed' &&
        current.phase !== 'requires_reconciliation') ||
      proposed.phase !== 'discovered' ||
      !proposed.attemptId
    ) {
      throw new ArtworkMigrationJournalError('JOURNAL_CORRUPT');
    }
    return;
  }

  const progress: ArtworkMigrationPhase[] = [
    'discovered',
    'source_validated',
    'upload_started',
    'cloudinary_upload_confirmed',
    'provider_metadata_verified',
    'sha256_verified',
    'database_record_updated',
    'complete',
  ];
  const currentIndex = progress.indexOf(current.phase);
  const proposedIndex = progress.indexOf(proposed.phase);
  if (
    proposed.phase === 'failed' ||
    proposed.phase === 'requires_reconciliation'
  ) {
    if (
      current.phase === 'complete' ||
      current.phase === 'failed' ||
      current.phase === 'requires_reconciliation'
    ) {
      throw new ArtworkMigrationJournalError('JOURNAL_CORRUPT');
    }
    return;
  }
  if (
    current.phase === 'failed' ||
    current.phase === 'requires_reconciliation' ||
    currentIndex < 0 ||
    proposedIndex !== currentIndex + 1
  ) {
    throw new ArtworkMigrationJournalError('JOURNAL_CORRUPT');
  }
}

async function recoverJournal(
  filePath: string,
  validContent: string,
  replaceFile: typeof rename,
): Promise<void> {
  const temporaryPath = `${filePath}.recovery-${randomUUID()}`;
  let temporaryExists = false;
  try {
    const handle = await open(temporaryPath, 'wx', 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(validContent, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replaceFile(temporaryPath, filePath);
    temporaryExists = false;
  } catch {
    throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
  } finally {
    if (temporaryExists) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

async function assertSafeJournalParent(directory: string): Promise<void> {
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
    }
  } catch (error) {
    if (error instanceof ArtworkMigrationJournalError) throw error;
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
    }
  }
}

async function withJournalWriteLock<T>(
  filePath: string,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = `${filePath}.journal-write.lock`;
  let handle;
  let lockCreated = false;
  try {
    handle = await open(lockPath, 'wx', 0o600);
    lockCreated = true;
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      'utf8',
    );
    await handle.sync();
  } catch {
    await handle?.close().catch(() => undefined);
    if (lockCreated) await unlink(lockPath).catch(() => undefined);
    throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
  }
  try {
    await handle.close();
    return await action();
  } finally {
    await unlink(lockPath).catch(() => {
      throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
    });
  }
}

async function withJournalRunLock<T>(
  filePath: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await assertSafeJournalParent(path.dirname(filePath));
  } catch {
    throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
  }
  return withJournalWriteLockNamed(`${filePath}.lock`, action);
}

async function withJournalWriteLockNamed<T>(
  lockPath: string,
  action: () => Promise<T>,
): Promise<T> {
  let handle;
  let lockCreated = false;
  try {
    handle = await open(lockPath, 'wx', 0o600);
    lockCreated = true;
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      'utf8',
    );
    await handle.sync();
  } catch {
    await handle?.close().catch(() => undefined);
    if (lockCreated) await unlink(lockPath).catch(() => undefined);
    throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
  }
  try {
    await handle.close();
    return await action();
  } finally {
    await unlink(lockPath).catch(() => {
      throw new ArtworkMigrationJournalError('JOURNAL_UNAVAILABLE');
    });
  }
}

async function appendAndSync(filePath: string, content: string): Promise<void> {
  const handle = await open(filePath, 'a', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class ArtworkMigrationJournalError extends Error {
  constructor(
    public readonly code:
      'JOURNAL_UNAVAILABLE' | 'JOURNAL_CORRUPT' | 'JOURNAL_TARGET_MISMATCH',
  ) {
    super('Artwork migration journal is unavailable or invalid');
    this.name = 'ArtworkMigrationJournalError';
  }
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
