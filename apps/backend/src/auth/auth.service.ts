import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MerchantsService } from '../merchants';
import { UsersService } from '../users';
import type { AuthResponse, JwtPayload } from './auth.types';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly merchantsService: MerchantsService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const user = await this.usersService.create(dto.username, dto.password);

    return this.buildAuthResponse({
      id: user.id,
      username: user.username,
    });
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersService.findByUsername(dto.username);

    if (!user || user.password !== dto.password) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return this.buildAuthResponse({
      id: user.id,
      username: user.username,
    });
  }

  async getProfile(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const merchant = await this.merchantsService.findPublicProfileByUserId(
      user.id,
    );

    return { user, merchant };
  }

  private buildAuthResponse(user: {
    id: string;
    username: string;
  }): AuthResponse {
    const accessToken = this.jwtService.sign({
      sub: user.id,
      username: user.username,
    } satisfies JwtPayload);

    return {
      user,
      accessToken,
    };
  }
}
