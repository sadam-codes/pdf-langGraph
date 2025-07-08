import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ChatMessage } from '../model/chat-message.model';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { ChatGroq } from '@langchain/groq';
import { Pool } from 'pg';
import * as fs from 'fs/promises';
import * as pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import {
  PGVectorStore,
  DistanceStrategy,
} from '@langchain/community/vectorstores/pgvector';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Annotation, StateGraph } from '@langchain/langgraph';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Document } from '@langchain/core/documents';
import { pull } from 'langchain/hub';
import { RunnableConfig } from '@langchain/core/runnables';
import * as dotenv from 'dotenv';
dotenv.config();

// Gemini setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const pool = new Pool({
  host: process.env.DB_HOST!,
  port: 5432,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  database: process.env.DB_NAME!,
});

const checkpointer = new PostgresSaver(pool);
checkpointer
  .setup()
  .catch((e) => console.error('Checkpointer setup error:', e));

const llm = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY!,
  model: 'llama3-8b-8192',
});

const vectorConfig = {
  postgresConnectionOptions: {
    type: 'postgres',
    host: process.env.DB_HOST!,
    port: 5432,
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
  },
  tableName: 'testlangchainjs',
  columns: {
    idColumnName: 'id',
    vectorColumnName: 'vector',
    contentColumnName: 'content',
    metadataColumnName: 'metadata',
  },
  distanceStrategy: 'cosine' as DistanceStrategy,
};

async function geminiEmbeddingBatch(texts: string[]): Promise<number[][]> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-embedding-exp-03-07',
  });
  const embeddings: number[][] = [];

  for (const text of texts) {
    try {
      const result = await model.embedContent(text);
      embeddings.push(result.embedding.values);
      await new Promise((res) => setTimeout(res, 300));
    } catch (error) {
      console.error('Gemini API error:', error);
      throw new Error(`Gemini embedding failed: ${error}`);
    }
  }

  return embeddings;
}

const promptTemplatePromise = pull<ChatPromptTemplate>('rlm/rag-prompt');

const InputState = Annotation.Root({
  question: Annotation<string>,
});

const FullState = Annotation.Root({
  question: Annotation<string>,
  context: Annotation<Document[]>,
  answer: Annotation<string>,
});

const retrieve = async (state: typeof InputState.State) => {
  const embedding = await geminiEmbeddingBatch([state.question]);
  const vectorStore = await PGVectorStore.initialize(
    {
      async embedDocuments() {
        throw new Error('Not needed');
      },
      async embedQuery() {
        return embedding[0];
      },
    },
    vectorConfig,
  );
  const docs = await vectorStore.similaritySearch(state.question, 3);
  return { context: docs };
};

const generate = async (state: typeof FullState.State) => {
  const promptTemplate = await promptTemplatePromise;
  const contextText = state.context.map((doc) => doc.pageContent).join('\n');
  const messages = await promptTemplate.invoke({
    question: state.question,
    context: contextText,
  });
  const response = await llm.invoke(messages);
  return { answer: response.content };
};

const graph = new StateGraph(FullState)
  .addNode('retrieve', retrieve)
  .addNode('generate', generate)
  .addEdge('__start__', 'retrieve')
  .addEdge('retrieve', 'generate')
  .addEdge('generate', '__end__')
  .compile({ checkpointer });
@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatMessage)
    private chatModel: typeof ChatMessage,
  ) {}

  async embed(text: string): Promise<number[]> {
    const [vector] = await geminiEmbeddingBatch([text]);
    return vector;
  }

  async saveMessage(
    chatId: string,
    role: 'user' | 'assistant',
    content: string,
  ) {
    await this.chatModel.create({ chatId, role, content });
  }

  async getHistory(chatId: string) {
    return await this.chatModel.findAll({
      where: { chatId },
      order: [['createdAt', 'ASC']],
    });
  }

  async importPdfChunks(filePath: string) {
    const fileBuffer = await fs.readFile(filePath);
    const data = await pdfParse(fileBuffer);
    const text = data.text;

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 2000,
      chunkOverlap: 100,
    });

    const chunks = await splitter.splitText(text);
    const vectors = await geminiEmbeddingBatch(chunks);

    const documents = chunks.map((chunk, index) => ({
      pageContent: chunk,
      metadata: {
        id: uuidv4(),
        vector: vectors[index],
        source: filePath,
      },
    }));

    const embeddings = {
      async embedDocuments(_: string[]) {
        return vectors;
      },
      async embedQuery(_: string) {
        throw new Error('EmbedQuery not supported in importPdfChunks');
      },
    };

    const vectorStore = await PGVectorStore.initialize(
      embeddings,
      vectorConfig,
    );
    await vectorStore.addDocuments(documents);

    return { status: 'ok', chunks: documents.length };
  }

  extractText(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    }
    return '';
  }

  async chat(chatId: string, question: string) {
    console.log('Incoming Chat:', { chatId, question });

    const config: RunnableConfig = { configurable: { thread_id: chatId } };

    try {
      const result = await graph.invoke({ question }, config);
      const answer =
        this.extractText(result.answer) || 'No valid response returned.';

      await this.saveMessage(chatId, 'user', question);
      await this.saveMessage(chatId, 'assistant', answer);

      console.log('Outgoing Response:', { question, answer });
      return { question, answer };
    } catch (error) {
      console.error('❌ Error in LangGraph pipeline:', error);
      const fallback =
        'Sorry, something went wrong while processing your request.';
      await this.saveMessage(chatId, 'user', question);
      await this.saveMessage(chatId, 'assistant', fallback);
      return { question, answer: fallback };
    }
  }
}
