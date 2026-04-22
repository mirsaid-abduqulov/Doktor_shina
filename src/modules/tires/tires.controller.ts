import { Body, Controller, Get, Post, UseInterceptors } from '@nestjs/common';
import { TiresService } from './tires.service';
import { CreateTireDto } from './dto/create-tire.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';

@Controller('tires')
export class TiresController {
  constructor(private readonly tiresService: TiresService) { }

  @Post('create')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        nomi: { type: 'string', description: 'Nomi' },
        razmer: { type: 'string', description: 'Shina razmerlari' },
        narx: { type: 'number', description: 'Narxi' },
        soni: { type: 'number', description: 'Soni' },
        photos: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Shina suratlari(max 2 ta)',
        },
      },
      required: ['nomi', 'razmer', 'narx', 'soni', 'photos'],
    },
  })
  @UseInterceptors(FilesInterceptor('photos', 2))
  async createTire(@Body() body: CreateTireDto) {
    return await this.tiresService.create(body);
  }
}
