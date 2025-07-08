import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async handleChat(@Body() body: { chatId: string; question: string }) {
    const { chatId, question } = body;

    if (!chatId || !question) {
      throw new BadRequestException('chatId and question are required');
    }

    console.log('Incoming Chat:', { chatId, question });

    const result = await this.chatService.chat(chatId, question);

    console.log('Outgoing Response:', result);

    return result;
  }
}
