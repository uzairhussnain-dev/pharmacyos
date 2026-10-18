import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import { Connection } from 'mongoose';
import { Public } from '../../common/decorators';

@ApiTags('system')
@Controller()
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()), timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready() {
    const dbReady = this.connection.readyState === 1;
    if (!dbReady) throw new ServiceUnavailableException({ status: 'not_ready', database: 'disconnected' });
    try {
      await this.connection.db!.admin().ping();
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready', database: 'ping_failed' });
    }
    return { status: 'ready', database: 'connected' };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
