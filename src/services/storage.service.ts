import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { config } from '../config/index.js';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const hasExplicitCreds = config.objectStore.accessKey && config.objectStore.secretKey;
    s3Client = new S3Client({
      endpoint: config.objectStore.endpoint,
      region: config.objectStore.region,
      // Only pass explicit credentials for local dev / MinIO.
      // In ECS production the task role provides credentials automatically.
      ...(hasExplicitCreds && {
        credentials: {
          accessKeyId: config.objectStore.accessKey,
          secretAccessKey: config.objectStore.secretKey,
        },
      }),
      forcePathStyle: true, // Required for MinIO; harmless for AWS S3
    });
  }
  return s3Client;
}

export async function uploadFile(
  key: string,
  stream: NodeJS.ReadableStream,
  mimeType: string,
): Promise<void> {
  const client = getS3Client();
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  const body = Buffer.concat(chunks);

  await client.send(
    new PutObjectCommand({
      Bucket: config.objectStore.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
      ServerSideEncryption: 'AES256',
    }),
  );
}

export async function generatePresignedUrl(key: string, ttlSeconds: number): Promise<string> {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: config.objectStore.bucket,
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: ttlSeconds });
}

export async function checkBucketReachable(): Promise<void> {
  const client = getS3Client();
  await client.send(
    new HeadBucketCommand({
      Bucket: config.objectStore.bucket,
    }),
  );
}

export function buildStorageKey(patientId: string, recordId: string, fileName: string): string {
  // Sanitize file name to prevent path traversal
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `patients/${patientId}/records/${recordId}/${safeName}`;
}

// Re-export Readable for convenience in tests
export { Readable };
