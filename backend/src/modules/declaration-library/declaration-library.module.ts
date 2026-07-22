import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeclarationLibraryBlockEntity } from '../../database/entities/declaration-library-block.entity';
import { AuthModule } from '../auth/auth.module';
import { DeclarationLibraryController } from './declaration-library.controller';
import { DeclarationLibraryService } from './declaration-library.service';

@Module({
  imports: [TypeOrmModule.forFeature([DeclarationLibraryBlockEntity]), AuthModule],
  controllers: [DeclarationLibraryController],
  providers: [DeclarationLibraryService],
  exports: [DeclarationLibraryService],
})
export class DeclarationLibraryModule {}
