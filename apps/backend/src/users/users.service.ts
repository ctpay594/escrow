import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase';
import type { PublicUser, UserListItem, UserRecord } from './users.types';

@Injectable()
export class UsersService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findByUsername(username: string): Promise<UserRecord | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('users')
      .select('*')
      .ilike('username', this.escapeIlikeExact(username.trim()))
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to look up user');
    }

    return data as UserRecord | null;
  }

  async findById(id: string): Promise<PublicUser | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('users')
      .select('id, username')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to look up user');
    }

    return data;
  }

  async findAll(): Promise<UserListItem[]> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('users')
      .select('id, username, password, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException('Failed to list users');
    }

    return data ?? [];
  }

  async updateUsername(id: string, username: string): Promise<UserListItem> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('users')
      .update({ username })
      .eq('id', id)
      .select('id, username, password, created_at, updated_at')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('Username already taken');
      }

      throw new InternalServerErrorException('Failed to update username');
    }

    if (!data) {
      throw new NotFoundException('User not found');
    }

    return data;
  }

  async updatePassword(id: string, password: string): Promise<UserListItem> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('users')
      .update({ password })
      .eq('id', id)
      .select('id, username, password, created_at, updated_at')
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to update password');
    }

    if (!data) {
      throw new NotFoundException('User not found');
    }

    return data;
  }

  async delete(id: string): Promise<{ id: string }> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('users')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to delete user');
    }

    if (!data) {
      throw new NotFoundException('User not found');
    }

    return { id: data.id as string };
  }

  async create(username: string, password: string): Promise<UserListItem> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('users')
      .insert({ username, password })
      .select('id, username, password, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('Username already taken');
      }

      throw new InternalServerErrorException('Failed to create user');
    }

    return data;
  }

  private escapeIlikeExact(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  }
}
