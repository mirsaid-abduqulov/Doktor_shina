// create-tire.dto.ts
import { Type } from 'class-transformer';
import { IsString, IsNumber, Min, IsNotEmpty } from 'class-validator';

export class CreateTireDto {
  @IsString()
  @IsNotEmpty()
  name: string; // Masalan: Lassa Multiways

  @IsString()
  @IsNotEmpty()
  size: string; // Masalan: 205/55 R16

  @IsNumber({ maxDecimalPlaces: 2 }) // Verguldan keyin 2 ta raqamgacha ruxsat
  @Min(0)
  @Type(() => Number) // BU JUDA MUHIM: Stringni Numberga o'giradi
  price: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number) // String bo'lib kelgan sonni Numberga o'giradi
  count: number;
}
