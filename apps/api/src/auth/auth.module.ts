import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { LoginThrottle } from './login-throttle';
import { SignupThrottle } from './signup-throttle';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthRepository, AuthService, LoginThrottle, SignupThrottle, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
