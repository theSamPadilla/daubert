import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LabeledEntityEntity } from '../../database/entities/labeled-entity.entity';
import { LabeledEntitiesController } from './labeled-entities.controller';
import { LabeledEntitiesService } from './labeled-entities.service';

@Module({
  imports: [TypeOrmModule.forFeature([LabeledEntityEntity])],
  controllers: [LabeledEntitiesController],
  providers: [LabeledEntitiesService],
  exports: [LabeledEntitiesService],
})
export class LabeledEntitiesModule {}
