import { Injectable } from '@nestjs/common';
import { AsyncTaskPublisher } from '@/shared/messaging/AsyncTaskPublisher';

export const WS_RELAY_TASK_TYPE = 'ws.relay';

/**
 * Envía un evento WebSocket a un usuario a través de api-auth (dueño del STOMP), publicando la tarea
 * `ws.relay` — igual que `AsyncTaskRelayWebSocketEventPublisher` de soluquim-commons.
 *
 * OJO: `type` debe existir en el enum Java `WebSocketEventType` de soluquim-commons; si no, api-auth no
 * puede deserializar el mensaje y termina en la DLQ. Antes de usar un tipo nuevo, agregarlo allí.
 */
@Injectable()
export class WsRelayPublisher {
  constructor(private readonly publisher: AsyncTaskPublisher) {}

  async publish<T>(userId: string, type: string, payload: T): Promise<void> {
    await this.publisher.publish(WS_RELAY_TASK_TYPE, { userId, type, payload });
  }
}
