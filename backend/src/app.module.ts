import { Module } from '@nestjs/common';
import { PdfController } from './pdf/pdf.controller';
import { PdfService } from './pdf/pdf.service';

@Module({
  controllers: [PdfController],
  providers: [PdfService],
})
export class AppModule {}
