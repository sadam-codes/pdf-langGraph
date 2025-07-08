import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
} from 'sequelize-typescript';

@Table({ tableName: 'chat_messages', timestamps: true })
export class ChatMessage extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare chatId: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare role: 'user' | 'assistant';

  @Column({ type: DataType.TEXT, allowNull: false })
  declare content: string;
}
