import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { Mailer } from '../mail/mailer';
import { LoginThrottle } from './login-throttle';
import { ResetThrottle } from './reset-throttle';
import { SignupThrottle } from './signup-throttle';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthRepository, AuthService, LoginThrottle, SignupThrottle, ResetThrottle, Mailer, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
