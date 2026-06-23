import { IsNotEmpty, IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum Role {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  STAFF = 'staff',
}
export class CreateAdminDto {
  @ApiProperty({ example: '123456789' })
  @IsNotEmpty()
  @Type(() => BigInt)
  telegramId: bigint;

  @ApiProperty({ example: 'John Doe' }) 
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'admin', default: 'admin' })
  @IsString()
  @IsOptional()
  role?: Role;

  @ApiProperty({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
