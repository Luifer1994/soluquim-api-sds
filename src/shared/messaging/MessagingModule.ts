import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AmqpConnection } from '@/shared/messaging/AmqpConnection';
import { AsyncTaskDispatcher } from '@/shared/messaging/AsyncTaskDispatcher';
import { AsyncTaskPublisher } from '@/shared/messaging/AsyncTaskPublisher';
import { WsRelayPublisher } from '@/shared/messaging/WsRelayPublisher';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [AmqpConnection, AsyncTaskPublisher, AsyncTaskDispatcher, WsRelayPublisher],
  exports: [AmqpConnection, AsyncTaskPublisher, AsyncTaskDispatcher, WsRelayPublisher],
})
export class MessagingModule {}
