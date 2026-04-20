import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');
  private readonly logDir = path.join(process.cwd(), 'logs');
  private readonly logFile = path.join(this.logDir, 'error.log');

  constructor() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    if (status >= 500) {
      const errorLog = {
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
        status,
        message:
          exception instanceof Error
            ? exception.message
            : typeof message === 'string'
              ? message
              : JSON.stringify(message),
        stack: exception instanceof Error ? exception.stack : null,
      };

      const logMessage = `[${errorLog.timestamp}] ${errorLog.method} ${errorLog.path} - Status: ${status}\nMessage: ${errorLog.message}\nStack: ${errorLog.stack}\n${'-'.repeat(50)}\n`;

      fs.appendFileSync(this.logFile, logMessage, 'utf8');
      this.logger.error(`Critical error logged to file: ${errorLog.path}`);
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message:
        typeof message === 'object' && message !== null && 'message' in message
          ? (message as { message: unknown }).message
          : message,
    });
  }
}
