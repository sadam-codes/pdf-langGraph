import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PdfService } from './pdf.service';

@Controller('pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { dest: './uploads' }))
  async uploadPdf(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error('File required');
    const chunks = await this.pdfService.processPdf(file.path);
    return { chunks };
  }
}
