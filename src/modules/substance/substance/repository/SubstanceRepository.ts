import { Injectable } from '@nestjs/common';
import { Substance } from '@prisma/client';
import { PrismaService } from '@/shared/persistence';

export interface SubstanceIdentity {
  name?: string;
  iupacName?: string;
  formula?: string;
  synonyms?: string[];
}

@Injectable()
export class SubstanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByCas(cas: string): Promise<Substance | null> {
    return this.prisma.substance.findUnique({ where: { cas } });
  }

  /** Crea la sustancia si no existe (los datos por fuente cuelgan de ella). */
  async ensureExists(cas: string): Promise<void> {
    await this.prisma.substance.upsert({ where: { cas }, create: { cas }, update: {} });
  }

  /** Actualiza solo los campos que vienen con valor: una fuente sin nombre no borra el de otra. */
  async updateIdentity(cas: string, identity: SubstanceIdentity): Promise<void> {
    const data = Object.fromEntries(
      Object.entries(identity).filter(
        ([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && !value.length),
      ),
    );
    if (!Object.keys(data).length) return;
    await this.prisma.substance.update({ where: { cas }, data });
  }
}
