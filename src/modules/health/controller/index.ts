import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public';

type HealthResponse = {
  checks?: {
    mongodb: string;
  };
  status: 'alive' | 'ready' | 'unavailable';
  timestamp: string;
  uptimeSeconds: number;
};

@Public()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get('live')
  @ApiOperation({ summary: 'Report process liveness' })
  @ApiOkResponse({ description: 'The backend process is alive.' })
  @Header('Cache-Control', 'no-store')
  getLiveness(): HealthResponse {
    return this.createResponse('alive');
  }

  @Get('ready')
  @ApiOperation({ summary: 'Report readiness including MongoDB connectivity' })
  @ApiOkResponse({ description: 'The backend is ready to receive traffic.' })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable.' })
  @Header('Cache-Control', 'no-store')
  getReadiness(): HealthResponse {
    const mongodb = this.getMongoStatus();
    if (this.connection.readyState !== 1) {
      throw new ServiceUnavailableException(this.createResponse('unavailable', mongodb));
    }

    return this.createResponse('ready', mongodb);
  }

  private createResponse(status: HealthResponse['status'], mongodb?: string): HealthResponse {
    return {
      ...(mongodb ? { checks: { mongodb } } : {}),
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  private getMongoStatus() {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    return states[this.connection.readyState] ?? 'uninitialized';
  }
}
