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
  isAuthenticated: boolean;
  authError: string | null;
  authSuccess: string | null;
  wins: number;
  losses: number;
  setNeedsNickname: (val: boolean) => void;
  connect: () => void;
  getRooms: () => void;
  getUserStats: () => void;
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
  login: (username: string, password: string) => void;
  register: (username: string, password: string, nickname: string) => void;
  logout: () => void;
  clearAuthMessages: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  gameState: null,
  roomId: null,
  error: null,
  needsNickname: false,
  roomList: [],
  isAuthenticated: typeof window !== 'undefined' ? !!localStorage.getItem('tichu_user_id') : false,
  authError: null,
  authSuccess: null,
  wins: 0,
  losses: 0,

  setNeedsNickname: (val: boolean) => set({ needsNickname: val }),

  getRooms: () => {
    get().socket?.emit('getRooms');
  },

  getUserStats: () => {
    const userId = localStorage.getItem('tichu_user_id');
    if (userId) {
      get().socket?.emit('getUserStats', { userId });
    }
  },

  connect: () => {
    if (get().socket) return;
    
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
    const socket = io(serverUrl);
    
    socket.on('roomCreated', ({ roomId, gameState }) => {
      set({ roomId, gameState, error: null });
    });

    socket.on('gameStateUpdate', (gameState) => {
      set({ gameState, error: null });
      
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
      const myId = localStorage.getItem('tichu_user_id');
      if (myId) {
        socket.emit('getUserStats', { userId: myId });
      }

      const { roomId, gameState } = get();
      if (roomId && gameState) {
        const nickname = localStorage.getItem('tichu_nickname') || 'Player';
        socket.emit('joinRoom', { nickname, roomId: gameState.roomId, userId: getUserId() });
      } else {
        socket.emit('getRooms');
      }
    });

    socket.on('userStatsUpdate', ({ userId, wins, losses }) => {
      const myId = localStorage.getItem('tichu_user_id');
      if (myId === userId) {
        set({ wins: wins || 0, losses: losses || 0 });
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

    socket.on('loginSuccess', ({ userId, nickname, wins, losses, message }) => {
      localStorage.setItem('tichu_user_id', userId);
      localStorage.setItem('tichu_nickname', nickname);
      set({ isAuthenticated: true, authError: null, authSuccess: message, wins: wins || 0, losses: losses || 0 });
      socket.emit('getRooms');
    });

    socket.on('loginFailed', ({ message }) => {
      set({ authError: message, authSuccess: null, isAuthenticated: false });
    });

    socket.on('registerSuccess', ({ message }) => {
      set({ authSuccess: message, authError: null });
    });

    socket.on('registerFailed', ({ message }) => {
      set({ authError: message, authSuccess: null });
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
    get().socket?.emit('getRooms');
  },

  login: (username, password) => {
    get().socket?.emit('login', { username, password });
  },

  register: (username, password, nickname) => {
    get().socket?.emit('register', { username, password, nickname });
  },

  logout: () => {
    localStorage.removeItem('tichu_user_id');
    localStorage.removeItem('tichu_nickname');
    set({ isAuthenticated: false, authError: null, authSuccess: null, gameState: null, roomId: null, wins: 0, losses: 0 });
  },

  clearAuthMessages: () => {
    set({ authError: null, authSuccess: null });
  }
}));
