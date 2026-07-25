import { Inject, Logger, UnauthorizedException, forwardRef } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthorizedSessionUser, SessionAuthorizationService } from '../../auth/session-authorization';
import { WhatsappManagerService, WhatsappClientSnapshot } from '../manager';
import type { QueueSnapshot } from '../message-queue';

const allowedSocketOrigins = (process.env.FRONTEND_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

type AuthenticatedWhatsappSocket = Socket & {
  data: Socket['data'] & {
    user?: AuthorizedSessionUser;
  };
};

@WebSocketGateway({
  namespace: 'whatsapp-ws',
  cors: {
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedSocketOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('WhatsApp socket origin is not allowed'), false);
    },
    credentials: true,
  },
})
export class WhatsappGateway implements OnGatewayConnection {
  private readonly logger = new Logger(WhatsappGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessionAuthorization: SessionAuthorizationService,
    @Inject(forwardRef(() => WhatsappManagerService))
    private readonly whatsappManager: WhatsappManagerService,
  ) {}

  async handleConnection(client: AuthenticatedWhatsappSocket) {
    try {
      client.data.user = await this.authenticate(client);
      this.logger.debug(`WhatsApp socket connected: ${client.id} for host ${client.data.user.hostId}`);
    } catch (error) {
      this.logger.warn(`Rejected unauthenticated WhatsApp socket ${client.id}: ${error instanceof Error ? error.message : String(error)}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('watch-host')
  async watchHost(
    @ConnectedSocket() client: AuthenticatedWhatsappSocket,
    @MessageBody()
    payload?: { connectionId?: string },
  ): Promise<WhatsappClientSnapshot> {
    const hostId = client.data.user?.hostId;
    if (!hostId) {
      throw new UnauthorizedException('Missing authenticated WhatsApp socket user');
    }

    try {
      const connectionId = payload?.connectionId ?? WhatsappManagerService.DEFAULT_CONNECTION_ID;
      const room = this.hostRoom(hostId, connectionId);
      await client.join(room);
      const snapshot = await this.whatsappManager.getStatus(hostId, connectionId);
      this.emitSnapshot(hostId, snapshot);
      return this.sanitizeSnapshot(snapshot);
    } catch (error) {
      this.logger.warn(`Failed watching WhatsApp host ${hostId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  emitSnapshot(hostId: string, snapshot: WhatsappClientSnapshot) {
    this.server.to(this.hostRoom(hostId, snapshot.connectionId)).emit('whatsapp-status', this.sanitizeSnapshot(snapshot));
  }

  emitQueueSnapshot(hostId: string, connectionId: string, snapshot: QueueSnapshot) {
    this.server.to(this.hostRoom(hostId, connectionId)).emit('whatsapp-queue', snapshot);
  }

  private hostRoom(hostId: string, connectionId: string) {
    return `host:${hostId}:whatsapp:${connectionId}`;
  }

  private async authenticate(client: Socket): Promise<AuthorizedSessionUser> {
    const token = this.getToken(client);
    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }

    return this.sessionAuthorization.authorize(token);
  }

  private getToken(client: Socket) {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.startsWith('Bearer ') ? authToken.slice(7) : authToken;
    }

    const authorization = client.handshake.headers.authorization;
    const header = Array.isArray(authorization) ? authorization[0] : authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : null;
  }

  private sanitizeSnapshot(snapshot: WhatsappClientSnapshot): WhatsappClientSnapshot {
    return {
      ...snapshot,
      qrCode: null,
    };
  }
}
