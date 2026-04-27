import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class KeepAliveService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KeepAliveService.name);

  constructor(private readonly configService: ConfigService) {}

  onApplicationBootstrap() {
    const appUrl = this.configService.get<string>('APP_URL');

    // Agar APP_URL bo'lmasa, ping ishlamasin (masalan, localhostda kerakmas)
    if (!appUrl) {
      this.logger.warn('APP_URL topilmadi, Keep-alive ping yoqilmadi.');
      return;
    }

    const url = `${appUrl}/products/health`;

    this.logger.log(`Keep-alive xizmati ishga tushdi. URL: ${url}`);

    // Loyiha to'liq yurguncha kutib, keyin boshlaymiz
    setTimeout(() => {
      this.startPing(url);
    }, 30000);
  }

  private startPing(url: string) {
    // 13 daqiqa (780,000 ms) - Render limitiga mos va xavfsiz
    const intervalTime = 1000 * 60 * 10;

    setInterval(async () => {
      try {
        // timeout qo'shish shart, aks holda so'rov osilib qolsa resurs yeydi
        const response = await axios.get(url, {
          timeout: 10000,
          headers: { 'User-Agent': 'Render-Keep-Alive-Bot' },
        });
        this.logger.log(`Ping status: ${response.status} - ${url}`);
      } catch (e) {
        console.log(e)
        this.logger.error(`Ping xatosi: ${e.response?.status || e.message}`);
      }
    }, intervalTime);
  }
}
