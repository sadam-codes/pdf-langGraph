import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as pdfParse from 'pdf-parse';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import {
  PGVectorStore,
  DistanceStrategy,
} from '@langchain/community/vectorstores/pgvector';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

interface Document {
  pageContent: string;
  metadata: Record<string, any>;
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function geminiEmbeddingBatch(texts: string[]): Promise<number[][]> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-embedding-exp-03-07',
  });
  const embeddings: number[][] = [];

  for (const text of texts) {
    try {
      const result = await model.embedContent(text);
      embeddings.push(result.embedding.values);
      await delay(1000); // 🛑 Critical line: 1-second delay to avoid 429
    } catch (error) {
      console.error('Gemini API error:', error);
      throw new Error(`Gemini embedding failed: ${error}`);
    }
  }

  return embeddings;
}

const config = {
  postgresConnectionOptions: {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'langGraphAgent',
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

@Injectable()
export class PdfService {
  async processPdf(filePath: string) {
    const fileBuffer = await fs.readFile(filePath);
    const data = await pdfParse(fileBuffer);
    const text = data.text;

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 2000,
      chunkOverlap: 200,
    });

    const chunks = (await splitter.splitText(text)).slice(0, 5); 
    const vectors = await geminiEmbeddingBatch(chunks);

    const documents: Document[] = chunks.map((chunk, index) => ({
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
        throw new Error('embedQuery not supported in PdfService.');
      },
    };

    const vectorStore = await PGVectorStore.initialize(embeddings, config);
    await vectorStore.addDocuments(documents);

    return documents.map((doc) => ({
      id: doc.metadata.id,
      content: doc.pageContent,
    }));
  }
}
