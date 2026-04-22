import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class KeepAliveService implements OnModuleInit {
  private readonly logger = new Logger(KeepAliveService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const appUrl = this.configService.get<string>('APP_URL') || 'https://shina-bot.onrender.com';
    const url = `${appUrl}/tires/health`;
    
    // Har 5 daqiqada so'rov yuboradi
    setInterval(async () => {
      try {
        await axios.get(url);
        this.logger.log(`Keep-alive ping muvaffaqiyatli: ${url}`);
      } catch (e) {
        this.logger.error(`Keep-alive pingda xato (${url}): ${e.message}`);
      }
    }, 1000 * 60 * 5); 
  }
}
