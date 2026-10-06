import { Injectable } from '@nestjs/common';
import { AiProviderFactory } from '@/shared/ai/factory/AiProviderFactory';
import { AppConfig } from '@/shared/config';

/** ¿La IA está disponible? (proveedor válido + credenciales). Para responder claro en vez de fallar. */
@Injectable()
export class AiStatus {
  constructor(private readonly config: AppConfig) {}

  get enabled(): boolean {
    return AiProviderFactory.isConfigured(this.config);
  }

  get provider(): string {
    return this.config.ai.provider;
  }
}
