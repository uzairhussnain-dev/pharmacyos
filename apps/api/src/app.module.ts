import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { EnvConfig, validateEnv } from './config/env.config';
import { DatabaseModule } from './database/database.module';
import { SchemasModule } from './database/schemas.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductsModule } from './modules/products/products.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { CustomersModule } from './modules/customers/customers.module';
import { CashSessionsModule } from './modules/cash-sessions/cash-sessions.module';
import { PosModule } from './modules/pos/pos.module';
import { SalesModule } from './modules/sales/sales.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { ReportsModule } from './modules/reports/reports.module';
import { FinanceModule } from './modules/finance/finance.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { PaymentsModule } from './modules/payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env', '../../.env'] }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          genReqId: (req) => (req.headers['x-request-id'] as string) ?? '',
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'req.body.password'],
            censor: '[REDACTED]',
          },
          autoLogging: { ignore: (req) => (req.url ?? '').endsWith('/health') || (req.url ?? '').endsWith('/ready') },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
              : undefined,
        },
      }),
    }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }], skipIf: () => process.env.NODE_ENV === 'test' }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    SchemasModule,
    AuditModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    InventoryModule,
    SuppliersModule,
    PurchasingModule,
    CustomersModule,
    CashSessionsModule,
    PosModule,
    SalesModule,
    PaymentsModule,
    ExpensesModule,
    ReportsModule,
    FinanceModule,
    IntelligenceModule,
    ReconciliationModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
