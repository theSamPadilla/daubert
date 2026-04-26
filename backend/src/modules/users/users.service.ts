import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
  ) {}

  async findByFirebaseUid(uid: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ firebaseUid: uid });
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ email });
  }

  async linkFirebaseUid(
    userId: string,
    firebaseUid: string,
    profile: { name?: string; avatarUrl?: string | null },
  ): Promise<UserEntity> {
    await this.repo.update(userId, {
      firebaseUid,
      ...(profile.name && { name: profile.name }),
      ...(profile.avatarUrl !== undefined && { avatarUrl: profile.avatarUrl }),
    });
    return this.repo.findOneByOrFail({ id: userId });
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ id });
  }

  async create(data: { email: string; name: string; avatarUrl?: string | null }): Promise<UserEntity> {
    return this.repo.save(this.repo.create(data));
  }

  async findAll(): Promise<UserEntity[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async delete(id: string): Promise<void> {
    const user = await this.repo.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    await this.repo.remove(user);
  }
}
