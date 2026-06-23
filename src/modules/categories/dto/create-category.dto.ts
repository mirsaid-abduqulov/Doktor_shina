import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Shinalar' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Yengil avtomobillar uchun shinalar', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'uuid-parent-id', required: false })
  @IsString()
  @IsOptional()
  parentId?: string;
}
