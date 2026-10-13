import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Global, Logger, Module } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Where uploaded PDFs live. Keys look like "<shipment id>/<document id>.pdf". */
export interface ObjectStorage {
  readonly kind: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export const STORAGE = Symbol('STORAGE');

export class DiskStorage implements ObjectStorage {
  readonly kind: string;
  constructor(private readonly root: string) {
    this.kind = `disk:${root}`;
  }

  async put(key: string, body: Buffer) {
    const file = join(this.root, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  get(key: string) {
    return readFile(join(this.root, key));
  }
}

/** Any S3-compatible service: MinIO, SeaweedFS (scripts/dev-s3.sh), AWS S3, Cloudflare R2. */
export class S3Storage implements ObjectStorage {
  readonly kind: string;
  private readonly client: S3Client;
  private bucketReady?: Promise<void>;

  constructor(endpoint: string, private readonly bucket: string, accessKeyId: string, secretAccessKey: string, region = 'us-east-1') {
    this.kind = `s3:${endpoint}/${bucket}`;
    this.client = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  }

  /** Creates the bucket on first use, so a fresh local server works without manual setup. */
  private ensureBucket() {
    this.bucketReady ??= this.client
      .send(new HeadBucketCommand({ Bucket: this.bucket }))
      .then(() => undefined)
      .catch(async () => {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        Logger.log(`Created bucket ${this.bucket}`, 'Storage');
      })
      .catch((err) => {
        this.bucketReady = undefined;
        throw err;
      });
    return this.bucketReady;
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
}

/** S3 when S3_ENDPOINT is set, otherwise the local folder STORAGE_DIR. */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  if (env.S3_ENDPOINT) {
    return new S3Storage(env.S3_ENDPOINT, env.S3_BUCKET ?? 'doccheck', env.S3_ACCESS_KEY ?? '', env.S3_SECRET_KEY ?? '', env.S3_REGION);
  }
  return new DiskStorage(resolve(env.STORAGE_DIR ?? '.data/uploads'));
}

@Global()
@Module({
  providers: [{ provide: STORAGE, useFactory: () => storageFromEnv() }],
  exports: [STORAGE],
})
export class StorageModule {}
