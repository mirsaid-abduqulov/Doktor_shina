import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class KeepAliveService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KeepAliveService.name);

  constructor(private readonly configService: ConfigService) {}

  onApplicationBootstrap() {
    const appUrl = this.configService.get<string>('APP_URL') || 'https://shina-bot.onrender.com';
    const url = `${appUrl}/tires/health`;
    
    // Loyiha to'liq yurguncha 30 soniya kutib, keyin pingni boshlaymiz
    setTimeout(() => {
      this.startPing(url);
    }, 30000);
  }

  private startPing(url: string) {
    setInterval(async () => {
      try {
        await axios.get(url);
        this.logger.log(`Keep-alive ping muvaffaqiyatli: ${url}`);
      } catch (e) {
        this.logger.error(`Keep-alive pingda xato (${url}): ${e.message}`);
      }
    }, 1000 * 60 * 5); // Har 5 daqiqada
  }
}
