import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminJwtPayload } from './admin.types';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminJwtPayload => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ admin: AdminJwtPayload }>();
    return request.admin;
  },
);
