import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GrokMessage } from '../grok/client.js';

export interface ConversationSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workingDirectory: string;
  messages: GrokMessage[];
}

export class HistoryManager {
  private historyDir: string;

  constructor() {
    this.historyDir = path.join(os.homedir(), '.config', 'grokcodecli', 'history');
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.historyDir, { recursive: true });
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private getSessionPath(id: string): string {
    return path.join(this.historyDir, `${id}.json`);
  }

  async createSession(workingDirectory: string): Promise<ConversationSession> {
    await this.ensureDir();

    const session: ConversationSession = {
      id: this.generateId(),
      title: 'New Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workingDirectory,
      messages: [],
    };

    await this.saveSession(session);
    return session;
  }

  async saveSession(session: ConversationSession): Promise<void> {
    await this.ensureDir();
    session.updatedAt = new Date().toISOString();

    // Generate title from first user message if not set
    if (session.title === 'New Conversation' && session.messages.length > 1) {
      const firstUserMsg = session.messages.find(m => m.role === 'user');
      if (firstUserMsg) {
        session.title = firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
      }
    }

    await fs.writeFile(
      this.getSessionPath(session.id),
      JSON.stringify(session, null, 2),
      'utf-8'
    );
  }

  async loadSession(id: string): Promise<ConversationSession | null> {
    try {
      const content = await fs.readFile(this.getSessionPath(id), 'utf-8');
      return JSON.parse(content) as ConversationSession;
    } catch {
      return null;
    }
  }

  async listSessions(limit: number = 20): Promise<ConversationSession[]> {
    await this.ensureDir();

    try {
      const files = await fs.readdir(this.historyDir);
      const sessions: ConversationSession[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = await fs.readFile(path.join(this.historyDir, file), 'utf-8');
          sessions.push(JSON.parse(content));
        } catch {
          // Skip invalid files
        }
      }

      // Sort by updatedAt, newest first
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      return sessions.slice(0, limit);
    } catch {
      return [];
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.getSessionPath(id));
      return true;
    } catch {
      return false;
    }
  }

  async getLastSession(): Promise<ConversationSession | null> {
    const sessions = await this.listSessions(1);
    return sessions.length > 0 ? sessions[0] : null;
  }

  async clearAll(): Promise<void> {
    try {
      const files = await fs.readdir(this.historyDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(path.join(this.historyDir, file));
        }
      }
    } catch {
      // Ignore errors
    }
  }
}
