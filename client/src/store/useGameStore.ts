import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { getUserId } from '../utils/userId';

// GameState interface removed or integrated if not used

interface GameStore {
  socket: Socket | null;
  gameState: any | null;
  roomId: string | null;
  error: string | null;
  needsNickname: boolean;
  roomList: any[];
  setNeedsNickname: (val: boolean) => void;
  connect: () => void;
  getRooms: () => void;
  createRoom: (nickname: string, settings?: { targetScore: number, timeLimit: number }) => void;
  joinRoom: (nickname: string, roomId: string) => void;
  updateNickname: (newNickname: string) => void;
  startSoloTest: (nickname: string, settings?: { targetScore: number, timeLimit: number }) => void;
  answerGrandTichu: (callGrand: boolean) => void;
  passCards: (targetMap: { [targetId: string]: string }) => void;
  playCards: (cardIds: string[], wishValue?: number) => void;
  passTrick: () => void;
  giveDragonTrick: (targetId: string) => void;
  toggleReady: () => void;
  callSmallTichu: () => void;
  returnToWaitingRoom: () => void;
  playAgain: () => void;
  leaveRoom: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  gameState: null,
  roomId: null,
  error: null,
  needsNickname: false,
  roomList: [],

  setNeedsNickname: (val: boolean) => set({ needsNickname: val }),

  getRooms: () => {
    get().socket?.emit('getRooms');
  },

  connect: () => {
    if (get().socket) return;
    
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
    const socket = io(serverUrl);
    
    socket.on('roomCreated', ({ roomId, gameState }) => {
      set({ roomId, gameState, error: null });
    });

    socket.on('gameStateUpdate', (gameState) => {
      set({ gameState });
      
      // Update local storage settings if phase is WAITING (game settings might have changed)
      if (gameState.phase === 'WAITING' && gameState.settings) {
        localStorage.setItem('tichu_target_score', gameState.settings.targetScore.toString());
        localStorage.setItem('tichu_time_limit', gameState.settings.timeLimit.toString());
      }
    });

    socket.on('roomListUpdate', (rooms) => {
      set({ roomList: rooms });
    });

    // When socket reconnects, try to rejoin previous room
    socket.on('connect', () => {
      const { roomId, gameState } = get();
      if (roomId && gameState) {
        const nickname = localStorage.getItem('tichu_nickname') || 'Player';
        socket.emit('joinRoom', { nickname, roomId: gameState.roomId, userId: getUserId() });
      } else {
        socket.emit('getRooms');
      }
    });

    // If rejoin fails (room deleted etc.), clear state and go to lobby
    socket.on('error', (msg) => {
      if (msg === '방을 찾을 수 없습니다.' || msg === '방이 가득 찼습니다.') {
        set({ gameState: null, roomId: null, error: msg });
        socket.emit('getRooms');
      } else {
        set({ error: msg });
      }
    });

    // Listen for mobile browser tab switching back to visibility
    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          const currentSocket = get().socket;
          if (currentSocket) {
            currentSocket.connect(); // Force wake up socket if it was sleeping
            const { roomId, gameState } = get();
            if (roomId && gameState) {
              const nickname = localStorage.getItem('tichu_nickname') || 'Player';
              currentSocket.emit('joinRoom', { nickname, roomId: gameState.roomId, userId: getUserId() });
            } else {
              currentSocket.emit('getRooms');
            }
          }
        }
      });
    }

    set({ socket });
  },

  createRoom: (nickname, settings) => {
    get().socket?.emit('createRoom', { nickname, settings, userId: getUserId() });
  },

  joinRoom: (nickname, roomId) => {
    get().socket?.emit('joinRoom', { nickname, roomId, userId: getUserId() });
  },

  updateNickname: (newNickname) => {
    const roomId = get().gameState?.roomId;
    if (roomId) {
      get().socket?.emit('updateNickname', { roomId, newNickname });
    }
  },

  startSoloTest: (nickname, settings) => {
    get().socket?.emit('startSoloTest', { nickname, settings, userId: getUserId() });
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
  },

  toggleReady: () => {
    const roomId = get().gameState?.roomId;
    if (roomId) {
      get().socket?.emit('toggleReady', { roomId });
    }
  },

  callSmallTichu: () => {
    const roomId = get().gameState?.roomId;
    if (roomId) {
      get().socket?.emit('callSmallTichu', { roomId });
    }
  },

  returnToWaitingRoom: () => {
    const roomId = get().gameState?.roomId;
    if (roomId) {
      get().socket?.emit('returnToWaitingRoom', { roomId });
    }
  },

  playAgain: () => {
    const roomId = get().gameState?.roomId;
    if (roomId) {
      get().socket?.emit('playAgain', { roomId });
    }
  },

  leaveRoom: () => {
    const roomId = get().gameState?.roomId;
    if (roomId) {
      get().socket?.emit('leaveRoom', { roomId });
    }
    set({ gameState: null, roomId: null });
  }
}));
