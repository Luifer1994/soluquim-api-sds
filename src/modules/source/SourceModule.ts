import { Module, Type } from '@nestjs/common';
import { BaseSourceProvider } from '@/modules/source/base';
import { SourceController } from '@/modules/source/controller';
import {
  CompToxSourceProvider,
  EchaSourceProvider,
  IarcSourceProvider,
  IcscSourceProvider,
  InsstLepSourceProvider,
  NioshNpgSourceProvider,
  NistSourceProvider,
  OshaSourceProvider,
  PubChemSourceProvider,
} from '@/modules/source/provider';
import { SOURCE_PROVIDERS, SourceProviderRegistry } from '@/modules/source/registry';
import { ListSourcesService } from '@/modules/source/service';

/**
 * TODAS las fuentes implementadas. Agregar una fuente = sumarla aquí (y a SourceCodeEnum).
 * Cuáles se consultan lo decide SOURCES_ENABLED.
 */
const ALL_SOURCE_PROVIDERS: Type<BaseSourceProvider>[] = [
  // Identidad y clasificación
  PubChemSourceProvider,
  EchaSourceProvider,
  // Fichas de seguridad y límites de exposición
  IcscSourceProvider,
  NioshNpgSourceProvider,
  InsstLepSourceProvider,
  OshaSourceProvider,
  // Toxicología y propiedades
  CompToxSourceProvider,
  IarcSourceProvider,
  NistSourceProvider,
];

/** Adaptadores a las fuentes externas. No guarda nada: solo trae y normaliza. */
@Module({
  controllers: [SourceController],
  providers: [
    ...ALL_SOURCE_PROVIDERS,
    {
      provide: SOURCE_PROVIDERS,
      useFactory: (...providers: BaseSourceProvider[]) => providers,
      inject: ALL_SOURCE_PROVIDERS,
    },
    SourceProviderRegistry,
    ListSourcesService,
  ],
  exports: [SourceProviderRegistry],
})
export class SourceModule {}
