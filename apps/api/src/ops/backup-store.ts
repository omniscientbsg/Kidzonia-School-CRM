import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { OpsEnv } from './ops-env.js';
import { required } from './ops-env.js';

/**
 * Database backups in an S3-compatible bucket. Each backup is one object named
 * by the moment it was taken (UTC), e.g. `db-backups/kidzonia-20260927T213000Z.dump`,
 * so the newest sorts last and the age is readable without trusting the
 * store's own dates (which change if objects are copied between buckets).
 */

const NAME = /kidzonia-(\d{8}T\d{6}Z)\.dump$/;

export function backupKey(prefix: string, at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return `${prefix}kidzonia-${stamp}.dump`;
}

/** When a backup was taken, from its name; null for objects that aren't backups. */
export function backupTime(key: string): Date | null {
  const m = NAME.exec(key);
  if (!m?.[1]) return null;
  const s = m[1];
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Backups by age, oldest first; anything else in the bucket is ignored. */
export function sortBackups(keys: readonly string[]): { key: string; at: Date }[] {
  return keys
    .map((key) => ({ key, at: backupTime(key) }))
    .filter((b): b is { key: string; at: Date } => b.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Backups older than `keepDays`. The newest backup is never pruned, whatever
 * its age: if backups have been failing for a month, the last good one is all
 * there is.
 */
export function backupsToPrune(keys: readonly string[], now: Date, keepDays: number): string[] {
  const sorted = sortBackups(keys);
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  return sorted
    .slice(0, -1)
    .filter((b) => b.at.getTime() < cutoff)
    .map((b) => b.key);
}

export interface BackupStore {
  upload(key: string, localFile: string, sha256: string): Promise<void>;
  /** Every backup key under the prefix. */
  list(): Promise<string[]>;
  /** Downloads to `localFile` and checks the checksum recorded at upload. */
  download(key: string, localFile: string): Promise<void>;
  delete(keys: readonly string[]): Promise<void>;
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

export class S3BackupStore implements BackupStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly prefix: string,
    options: { region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string },
  ) {
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
      ...(options.accessKeyId && options.secretAccessKey
        ? {
            credentials: {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async upload(key: string, localFile: string, sha256: string) {
    const { size } = await stat(localFile);
    // One PUT (up to 5 GB), which covers this product's databases for years;
    // the length is given so the SDK streams the file rather than buffering it.
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(localFile),
        ContentLength: size,
        ContentType: 'application/octet-stream',
        Metadata: { sha256 },
      }),
    );
  }

  async list() {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      );
      for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  async download(key: string, localFile: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Backup ${key} is empty`);
    await pipeline(res.Body as Readable, createWriteStream(localFile, { mode: 0o600 }));
    const expected = res.Metadata?.sha256;
    if (expected) {
      const actual = await sha256File(localFile);
      if (actual !== expected) throw new Error(`Backup ${key} is corrupt (checksum mismatch)`);
    }
  }

  async delete(keys: readonly string[]) {
    // DeleteObjects takes at most 1,000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }
}

export function createBackupStore(env: OpsEnv): S3BackupStore {
  const region = env.BACKUP_S3_REGION ?? env.S3_REGION;
  const endpoint = env.BACKUP_S3_ENDPOINT ?? env.S3_ENDPOINT;
  const accessKeyId = env.BACKUP_S3_ACCESS_KEY_ID ?? env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.BACKUP_S3_SECRET_ACCESS_KEY ?? env.S3_SECRET_ACCESS_KEY;
  return new S3BackupStore(required(env.BACKUP_BUCKET, 'BACKUP_BUCKET'), env.BACKUP_PREFIX, {
    region: required(region, 'BACKUP_S3_REGION (or S3_REGION)'),
    ...(endpoint ? { endpoint } : {}),
    ...(accessKeyId ? { accessKeyId } : {}),
    ...(secretAccessKey ? { secretAccessKey } : {}),
  });
}

/** The newest backup, or the one named (a full key, or just its file name). */
export async function chooseBackup(store: BackupStore, prefix: string, name?: string) {
  const keys = await store.list();
  if (name && name !== 'latest') {
    const key = name.startsWith(prefix) ? name : `${prefix}${name}`;
    if (!keys.includes(key)) throw new Error(`No backup named ${key}`);
    return key;
  }
  const newest = sortBackups(keys).at(-1);
  if (!newest) throw new Error(`No backups found under ${prefix}`);
  return newest.key;
}
