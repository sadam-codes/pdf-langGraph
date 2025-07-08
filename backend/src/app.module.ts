import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ChatMessage } from './model/chat-message.model';
import { ChatModule } from './chat/chat.module';
import { PdfModule } from './pdf/pdf.module';

@Module({
  imports: [
    SequelizeModule.forRoot({
      dialect: 'postgres',
      host: process.env.DB_HOST,
      port: 5432,
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      models: [ChatMessage],
      autoLoadModels: true,
      synchronize: true,
    }),
    SequelizeModule.forFeature([ChatMessage]),
    ChatModule,
    PdfModule,
  ],
})
export class AppModule {}
