import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, User } from '@prisma/client';
import { ROLES_KEY } from './decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const req = context.switchToHttp().getRequest<{ user?: User }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('No autenticado');
    }
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Se requiere rol ${requiredRoles.join(' o ')}`,
      );
    }
    return true;
  }
}
