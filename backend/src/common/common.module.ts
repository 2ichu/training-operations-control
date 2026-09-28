import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DomainExceptionFilter } from './domain-exception.filter.js';

@Module({
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class CommonModule {}
