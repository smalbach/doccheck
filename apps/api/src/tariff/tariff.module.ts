import { Global, Module } from '@nestjs/common';
import { TariffService } from './tariff.service';

@Global()
@Module({ providers: [TariffService], exports: [TariffService] })
export class TariffModule {}
