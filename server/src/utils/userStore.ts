import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface User {
  username: string;
  passwordHash: string;
  nickname: string;
  wins?: number;
  losses?: number;
}

const DATA_DIR = path.join(process.cwd(), 'src', 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let usersMemory: User[] = [];

// Load users from JSON file
function loadUsers(): User[] {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      usersMemory = JSON.parse(data);
    } else {
      usersMemory = [];
      saveUsers();
    }
  } catch (error) {
    console.error('Error loading users, falling back to memory:', error);
    usersMemory = [];
  }
  return usersMemory;
}

// Save users to JSON file
function saveUsers() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(usersMemory, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving users to file:', error);
  }
}

// Hash password helper using SHA-256
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Initialize users list
loadUsers();

export const userStore = {
  registerUser(username: string, password: string, nickname: string): { success: boolean; message: string } {
    const trimmedUsername = username.trim().toLowerCase();
    const trimmedNickname = nickname.trim();

    if (!trimmedUsername || !password || !trimmedNickname) {
      return { success: false, message: '모든 필드를 입력해 주세요.' };
    }

    if (trimmedUsername.length < 3) {
      return { success: false, message: '아이디는 3글자 이상이어야 합니다.' };
    }

    loadUsers();

    const exists = usersMemory.some(u => u.username === trimmedUsername);
    if (exists) {
      return { success: false, message: '이미 존재하는 아이디입니다.' };
    }

    const passwordHash = hashPassword(password);
    usersMemory.push({
      username: trimmedUsername,
      passwordHash,
      nickname: trimmedNickname,
      wins: 0,
      losses: 0
    });

    saveUsers();
    return { success: true, message: '회원가입이 완료되었습니다.' };
  },

  authenticateUser(username: string, password: string): { success: boolean; message: string; user?: { username: string; nickname: string; wins: number; losses: number } } {
    const trimmedUsername = username.trim().toLowerCase();

    if (!trimmedUsername || !password) {
      return { success: false, message: '아이디와 비밀번호를 모두 입력해 주세요.' };
    }

    loadUsers();

    const user = usersMemory.find(u => u.username === trimmedUsername);
    if (!user) {
      return { success: false, message: '존재하지 않는 아이디입니다.' };
    }

    const passwordHash = hashPassword(password);
    if (user.passwordHash !== passwordHash) {
      return { success: false, message: '비밀번호가 일치하지 않습니다.' };
    }

    return {
      success: true,
      message: '로그인에 성공했습니다.',
      user: {
        username: user.username,
        nickname: user.nickname,
        wins: user.wins || 0,
        losses: user.losses || 0
      }
    };
  },

  getUserStats(username: string): { wins: number; losses: number } | null {
    loadUsers();
    const user = usersMemory.find(u => u.username === username.trim().toLowerCase());
    if (!user) return null;
    return {
      wins: user.wins || 0,
      losses: user.losses || 0
    };
  },

  addWin(username: string) {
    loadUsers();
    const user = usersMemory.find(u => u.username === username.trim().toLowerCase());
    if (user) {
      user.wins = (user.wins || 0) + 1;
      saveUsers();
    }
  },

  addLoss(username: string) {
    loadUsers();
    const user = usersMemory.find(u => u.username === username.trim().toLowerCase());
    if (user) {
      user.losses = (user.losses || 0) + 1;
      saveUsers();
    }
  },

  updateNickname(username: string, newNickname: string): { success: boolean; message: string } {
    const trimmedUsername = username.trim().toLowerCase();
    const trimmedNickname = newNickname.trim();

    if (!trimmedNickname) {
      return { success: false, message: '닉네임을 입력해 주세요.' };
    }

    loadUsers();

    const user = usersMemory.find(u => u.username === trimmedUsername);
    if (!user) {
      return { success: false, message: '사용자를 찾을 수 없습니다.' };
    }

    user.nickname = trimmedNickname;
    saveUsers();
    return { success: true, message: '닉네임이 수정되었습니다.' };
  }
};
