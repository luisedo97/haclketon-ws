import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { User } from '@prisma/client';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LinkCodesService } from './link-codes.service';

interface RegisterBody {
  email?: string;
  password?: string;
  displayName?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly linkCodesService: LinkCodesService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() body: RegisterBody) {
    if (!body.email || !body.password || !body.displayName) {
      throw new BadRequestException(
        'email, password y displayName son requeridos',
      );
    }
    return this.authService.register({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
    });
  }

  @Public()
  @Post('login')
  login(@Body() body: LoginBody) {
    if (!body.email || !body.password) {
      throw new BadRequestException('email y password son requeridos');
    }
    return this.authService.login({
      email: body.email,
      password: body.password,
    });
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return this.authService.toPublicUser(user);
  }

  @Post('link-code')
  async generateLinkCode(@CurrentUser() user: User) {
    const linkCode = await this.linkCodesService.generate(user.id);
    return {
      code: linkCode.code,
      expiresAt: linkCode.expiresAt.toISOString(),
    };
  }
}
