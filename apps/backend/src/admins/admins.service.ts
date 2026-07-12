import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase';
import type { AdminRecord, PublicAdmin } from './admins.types';

@Injectable()
export class AdminsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async count(): Promise<number> {
    const { count, error } = await this.supabaseService
      .getAdminClient()
      .from('admins')
      .select('*', { count: 'exact', head: true });

    if (error) {
      throw new InternalServerErrorException('Failed to count admins');
    }

    return count ?? 0;
  }

  async findByUsername(username: string): Promise<AdminRecord | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('admins')
      .select('*')
      .eq('username', username)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to look up admin');
    }

    return data as AdminRecord | null;
  }

  async findById(id: string): Promise<PublicAdmin | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('admins')
      .select('id, username')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to look up admin');
    }

    return data as PublicAdmin | null;
  }

  async create(username: string, password: string): Promise<PublicAdmin> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('admins')
      .insert({ username, password })
      .select('id, username')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('Username already taken');
      }

      throw new InternalServerErrorException('Failed to create admin');
    }

    return data as PublicAdmin;
  }
}
