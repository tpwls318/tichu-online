import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

// GameState interface removed or integrated if not used

interface GameStore {
  socket: Socket | null;
  gameState: any | null;
  roomId: string | null;
  error: string | null;
  connect: () => void;
  createRoom: (nickname: string, settings?: { targetScore: number, timeLimit: number }) => void;
  joinRoom: (nickname: string, roomId: string) => void;
  startSoloTest: (nickname: string, settings?: { targetScore: number, timeLimit: number }) => void;
  answerGrandTichu: (callGrand: boolean) => void;
  passCards: (targetMap: { [targetId: string]: string }) => void;
  playCards: (cardIds: string[], wishValue?: number) => void;
  passTrick: () => void;
  giveDragonTrick: (targetId: string) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  gameState: null,
  roomId: null,
  error: null,

  connect: () => {
    if (get().socket) return;
    
    const socket = io('http://localhost:3001');
    
    socket.on('roomCreated', ({ roomId, gameState }) => {
      set({ roomId, gameState, error: null });
    });

    socket.on('gameStateUpdate', (gameState) => {
      set({ gameState, error: null });
    });

    socket.on('error', (msg) => {
      set({ error: msg });
    });

    set({ socket });
  },

  createRoom: (nickname, settings) => {
    get().socket?.emit('createRoom', { nickname, settings });
  },

  joinRoom: (nickname, roomId) => {
    get().socket?.emit('joinRoom', { nickname, roomId });
  },

  startSoloTest: (nickname, settings) => {
    get().socket?.emit('startSoloTest', { nickname, settings });
  },

  answerGrandTichu: (callGrand) => {
    const roomId = get().gameState?.roomId;
    if (roomId) {
      get().socket?.emit('answerGrandTichu', { roomId, callGrand });
    }
  },

  passCards: (targetMap) => {
    const roomId = get().gameState?.roomId;
    if (roomId) {
      get().socket?.emit('passCards', { roomId, targetMap });
    }
  },

  playCards: (cardIds, wishValue) => {
    const roomId = get().gameState?.roomId;
    if (roomId) {
      get().socket?.emit('playCards', { roomId, cardIds, wishValue });
    }
  },

  passTrick: () => {
    const roomId = get().gameState?.roomId;
    if (roomId) {
      get().socket?.emit('passTrick', { roomId });
    }
  },

  giveDragonTrick: (targetId) => {
    const roomId = get().gameState?.roomId;
    if (roomId) {
      get().socket?.emit('giveDragonTrick', { roomId, targetId });
    }
  }
}));
