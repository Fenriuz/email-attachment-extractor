import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { EmailService } from './email.service';
import { ExtractEmailDto } from './dto/extract-email.dto';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Get('json')
  async extractJson(@Query() query: ExtractEmailDto) {
    const source = query.url || query.path;
    if (!source) {
      throw new BadRequestException(
        'Either "url" or "path" query parameter is required',
      );
    }
    return this.emailService.processEmail(source);
  }
}
