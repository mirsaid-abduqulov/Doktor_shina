import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('create')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        price: { type: 'number' },
        count: { type: 'number' },
        photos: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
      required: ['name', 'type', 'price', 'count', 'photos'],
    },
  })
  @UseInterceptors(FilesInterceptor('photos', 2))
  async create(@Body() body: CreateProductDto) {
    return await this.productsService.create(body);
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  checkHealth() {
    // Hech qanday logika kerak emas, shunchaki status 200 qaytsa kifoya
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'Keep-alive is active',
    };
  }
}
