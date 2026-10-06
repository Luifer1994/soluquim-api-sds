import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/persistence';

const gzipAsync = promisify(gzip);

export interface SaveRawSnapshot {
  cas: string;
  source: string;
  url: string;
  contentType: string;
  content: string;
}

/** Respuestas crudas de las fuentes, comprimidas (gzip). Permiten auditar y re-parsear sin volver a llamar. */
@Injectable()
export class RawSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(snapshot: SaveRawSnapshot): Promise<string> {
    const content = await gzipAsync(Buffer.from(snapshot.content, 'utf8'));
    const created = await this.prisma.rawSnapshot.create({
      data: {
        cas: snapshot.cas,
        source: snapshot.source,
        url: snapshot.url,
        contentType: snapshot.contentType.slice(0, 100),
        content,
        sha256: createHash('sha256').update(snapshot.content).digest('hex'),
      },
      select: { id: true },
    });
    return created.id;
  }
}
