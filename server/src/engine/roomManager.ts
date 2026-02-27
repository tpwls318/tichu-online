import { TichuEngine } from './engine.js';

export class RoomManager {
  private rooms: Map<string, TichuEngine> = new Map();

  createRoom(): string {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const engine = new TichuEngine(roomId);
    this.rooms.set(roomId, engine);
    return roomId;
  }

  getRoom(roomId: string): TichuEngine | undefined {
    return this.rooms.get(roomId);
  }

  removeRoom(roomId: string) {
    this.rooms.delete(roomId);
  }
}
