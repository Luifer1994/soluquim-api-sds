import { AiProviderFactory } from '@/shared/ai';
import { AppConfig, parseEnv } from '@/shared/config';

const config = (env: Record<string, string>) =>
  new AppConfig(parseEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/d', RABBITMQ_URL: 'amqp://u:p@h:5672', ...env }));

describe('AiProviderFactory', () => {
  it('crea los proveedores de OpenRouter por defecto', () => {
    const c = config({ OPENROUTER_API_KEY: 'k' });
    expect(AiProviderFactory.createLlm(c).name).toBe('openrouter');
    expect(AiProviderFactory.createEmbedding(c)).toMatchObject({
      name: 'openrouter',
      model: 'openai/text-embedding-3-small',
      dimensions: 1536,
    });
    expect(AiProviderFactory.isConfigured(c)).toBe(true);
  });

  it('sin clave: el servicio arranca pero la IA queda apagada', () => {
    expect(AiProviderFactory.isConfigured(config({}))).toBe(false);
  });

  it('un proveedor inexistente falla con la lista de disponibles', () => {
    expect(() => AiProviderFactory.createLlm(config({ AI_PROVIDER: 'nope' }))).toThrow(/Disponibles: openrouter/);
  });
});
