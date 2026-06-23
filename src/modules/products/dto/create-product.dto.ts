import { Type } from 'class-transformer';
import { IsString, IsNumber, Min, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ example: 'Michelin Pilot Sport 4' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'uuid-category-id' })
  @IsUUID()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ example: 'uuid-admin-id' })
  @IsUUID()
  @IsNotEmpty()
  createdById: string;

  @ApiProperty({ example: 120.50 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  price: number;

  @ApiProperty({ example: 4, default: 0 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  stockQty: number;

  @ApiProperty({ example: 'dona', default: 'dona' })
  @IsString()
  @IsOptional()
  unit?: string;
}
