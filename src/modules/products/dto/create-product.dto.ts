// create-tire.dto.ts
import { Type } from 'class-transformer';
import { IsString, IsNumber, Min, IsNotEmpty, IsEnum } from 'class-validator';
import { ProductType } from '@prisma/client';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(ProductType)
  @IsNotEmpty()
  type: ProductType;

  @IsNumber({ maxDecimalPlaces: 2 }) // Verguldan keyin 2 ta raqamgacha ruxsat
  @Min(0)
  @Type(() => Number) // BU JUDA MUHIM: Stringni Numberga o'giradi
  price: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number) // String bo'lib kelgan sonni Numberga o'giradi
  count: number;
}
