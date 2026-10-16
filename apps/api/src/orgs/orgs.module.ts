import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { OrgsController, SharesController } from './orgs.controller';
import { OrgsService } from './orgs.service';
import { RetentionJob } from './retention.job';

/** Organizations, members, invitations, shares and records retention. OrgsRepository and OrgGuard come from AuthModule. */
@Module({
  imports: [ShipmentsModule],
  controllers: [OrgsController, SharesController],
  providers: [OrgsService, RetentionJob],
})
export class OrgsModule {}
