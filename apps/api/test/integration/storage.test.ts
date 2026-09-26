import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it } from 'vitest';
import { LocalFileStorage, S3FileStorage } from '../../src/core/storage.js';
import type { FileStorage } from '../../src/core/storage.js';

/**
 * The same contract for every storage driver. The S3 driver runs against the
 * SeaweedFS S3 service from docker-compose (and the same image in CI), so both
 * drivers are proven before task photos depend on them.
 */
const s3 = {
  endpoint: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:59000',
  region: 'us-east-1',
  accessKeyId: process.env.TEST_S3_ACCESS_KEY ?? 'kidzonia',
  secretAccessKey: process.env.TEST_S3_SECRET_KEY ?? 'kidzonia-s3-secret',
};
const bucket = `kidzonia-test-${process.env.VITEST_POOL_ID ?? '0'}`;

beforeAll(async () => {
  const client = new S3Client({
    region: s3.region,
    endpoint: s3.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });
  // The S3 service may still be starting, so retry for a little while.
  for (let attempt = 1; ; attempt++) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      return;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return;
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}, 60_000);

const drivers: [string, () => FileStorage][] = [
  ['local disk', () => new LocalFileStorage(mkdtempSync(path.join(tmpdir(), 'kz-store-')))],
  ['S3 (SeaweedFS)', () => new S3FileStorage(bucket, s3)],
];

describe.each(drivers)('%s storage', (_name, make) => {
  const store = make();
  const key = (n: string) => `org/test/${n}-${String(Date.now())}.png`;

  it('round-trips bytes and content type', async () => {
    const k = key('a');
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 250]);
    await store.put(k, data, 'image/png');
    const got = await store.get(k);
    expect(got?.contentType).toBe('image/png');
    expect(got?.data.equals(data)).toBe(true);
  });

  it('overwrites an existing key', async () => {
    const k = key('b');
    await store.put(k, Buffer.from('one'), 'text/plain');
    await store.put(k, Buffer.from('two'), 'image/webp');
    const got = await store.get(k);
    expect(got?.data.toString()).toBe('two');
    expect(got?.contentType).toBe('image/webp');
  });

  it('returns null for a missing key', async () => {
    expect(await store.get(key('missing'))).toBeNull();
  });

  it('deletes, and deleting twice is harmless', async () => {
    const k = key('c');
    await store.put(k, Buffer.from('x'), 'image/png');
    await store.delete(k);
    expect(await store.get(k)).toBeNull();
    await store.delete(k);
  });

  it('refuses keys that could escape the storage area', async () => {
    await expect(store.put('../etc/passwd', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      /Unsafe/,
    );
    await expect(store.get('/absolute')).rejects.toThrow(/Unsafe/);
    await expect(store.delete('org/../../x')).rejects.toThrow(/Unsafe/);
  });
});

describe('S3 (SeaweedFS) credentials', () => {
  it('are really checked: a wrong secret is refused', async () => {
    const wrong = new S3FileStorage(bucket, { ...s3, secretAccessKey: 'not-the-secret' });
    await expect(wrong.put('org/test/x.png', Buffer.from('x'), 'image/png')).rejects.toThrow();
  });
});
