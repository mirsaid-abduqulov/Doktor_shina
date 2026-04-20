// create-admin.dto.ts
import { IsNumber, IsString, IsNotEmpty } from 'class-validator';

export class CreateAdminDto {
  @IsNumber()
  @IsNotEmpty()
  tgId: number;

  @IsString()
  @IsNotEmpty()
  fullName: string;
}
