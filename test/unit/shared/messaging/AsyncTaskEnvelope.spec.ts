import { AppConfig, parseEnv } from '@/shared/config';
import { RequestContext } from '@/shared/context';
import { AmqpConnection, AsyncTaskEnvelope, AsyncTaskPublisher, JAVA_ENVELOPE_TYPE_ID } from '@/shared/messaging';

/**
 * Contrato con soluquim-commons: el JSON debe tener EXACTAMENTE los campos de AsyncTaskEnvelope y
 * MessageContext de Java, y el header __TypeId__ que usa Jackson2JsonMessageConverter.
 */
describe('AsyncTaskPublisher — contrato con soluquim-commons', () => {
  const config = new AppConfig(
    parseEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db', RABBITMQ_URL: 'amqp://u:p@localhost:5672' }),
  );
  const publish = jest.fn().mockResolvedValue(undefined);
  const amqp = { publishChannel: { publish } } as unknown as AmqpConnection;
  const publisher = new AsyncTaskPublisher(amqp, config);

  beforeEach(() => publish.mockClear());

  it('publica en soluquim.tasks con el taskType como routing key y el sobre de Java', async () => {
    await RequestContext.run(
      {
        requestId: 'req-1',
        tenantId: '12',
        userId: '7',
        username: 'ana',
        permissions: [],
        roles: ['ADMIN'],
        language: 'es',
      },
      () => publisher.publish('sds.ping', { message: 'hola' }),
    );

    const [exchange, routingKey, content, options] = publish.mock.calls[0];
    const envelope = JSON.parse((content as Buffer).toString()) as AsyncTaskEnvelope;

    expect(exchange).toBe('soluquim.tasks');
    expect(routingKey).toBe('sds.ping');
    expect(Object.keys(envelope).sort()).toEqual(['context', 'messageId', 'occurredAt', 'payload', 'taskType']);
    expect(Object.keys(envelope.context!).sort()).toEqual(['email', 'roles', 'tenantId', 'userId', 'username']);
    expect(envelope).toMatchObject({
      taskType: 'sds.ping',
      payload: { message: 'hola' },
      context: { tenantId: '12', userId: '7', username: 'ana', email: null, roles: ['ADMIN'] },
    });
    expect(new Date(envelope.occurredAt).toISOString()).toBe(envelope.occurredAt);
    expect(options).toMatchObject({
      contentType: 'application/json',
      persistent: true,
      messageId: envelope.messageId,
      headers: { __TypeId__: JAVA_ENVELOPE_TYPE_ID, 'x-request-id': 'req-1' },
    });
  });

  it('sin request en curso publica con contexto vacío (null), igual que Java', async () => {
    await publisher.publish('sds.ping', {});
    const envelope = JSON.parse((publish.mock.calls[0][2] as Buffer).toString()) as AsyncTaskEnvelope;
    expect(envelope.context).toEqual({ tenantId: null, userId: null, email: null, username: null, roles: null });
  });
});
