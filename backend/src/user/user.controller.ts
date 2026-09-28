import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import { UserService } from './user.service.js';

// 화면: S25 사용자 (baseline 5-2). SYS_ADMIN 전용.
@Controller('users')
export class UserController {
  constructor(@Inject(UserService) private readonly users: UserService) {}

  @Get()
  @Authorize('S25', 'R')
  list(@Query() query: Record<string, unknown>) {
    return this.users.list(query);
  }

  @Get(':id')
  @Authorize('S25', 'R')
  detail(@Param('id') id: string) {
    return this.users.detail(parseId(id));
  }

  @Post()
  @Authorize('S25', 'C')
  create(@Body() body: unknown) {
    return this.users.create(body);
  }

  @Patch(':id')
  @Authorize('S25', 'U')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.users.update(parseId(id), body);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @Authorize('S25', 'U')
  resetPassword(@Param('id') id: string) {
    return this.users.resetPassword(parseId(id));
  }
}
