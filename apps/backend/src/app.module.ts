import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminModule } from './admin';
import { AuthModule } from './auth';
import { TransfersModule } from './transfers';
import { CryptoModule } from './crypto';
import { HealthModule } from './health';
import { SupabaseModule } from './supabase';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    SupabaseModule,
    CryptoModule,
    HealthModule,
    AuthModule,
    TransfersModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
