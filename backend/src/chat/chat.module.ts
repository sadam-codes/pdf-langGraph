import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { SequelizeModule } from '@nestjs/sequelize';
import { ChatMessage } from '../model/chat-message.model';

@Module({
  imports: [SequelizeModule.forFeature([ChatMessage])],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
