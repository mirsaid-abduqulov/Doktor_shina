import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class KeepAliveService implements OnModuleInit {
  private readonly logger = new Logger(KeepAliveService.name);

  onModuleInit() {
    // Render-dagi loyihangizning URL manzili
    const url = `${process.env.APP_URL}/tires/health` || 'https://shina-bot.onrender.com/tires/health';

    // Har 5 daqiqada (5 * 60 * 1000 ms) so'rov yuboradi
    setInterval(async () => {
      try {
        await axios.get(url);
        this.logger.log(`Keep-alive ping muvaffaqiyatli: ${url}`);
      } catch (e) {
        this.logger.error(`Keep-alive pingda xato: ${e.message}`);
      }
    }, 1000 * 60 * 5); 
  }
}
