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
import { MfaService } from './mfa.service';
import { SsoService } from './sso.service';
import { OrgGuard } from '../orgs/org.guard';
import { OrgsRepository } from '../orgs/orgs.repository';

@Global()
@Module({
  controllers: [AuthController],
  // AuthGuard first (who), then OrgGuard (in which organization, with which role).
  providers: [
    AuthRepository, AuthService, MfaService, SsoService, OrgsRepository, LoginThrottle, SignupThrottle, ResetThrottle, Mailer,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: OrgGuard },
  ],
  exports: [AuthService, OrgsRepository, SsoService, Mailer],
})
export class AuthModule {}
