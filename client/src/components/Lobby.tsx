import React, { useState, useCallback, useRef, memo } from 'react';
import './Lobby.css';
import { CustomSelect } from './CustomSelect';
import { getUserId } from '../utils/userId';
import { useGameStore } from '../store/useGameStore';

interface SettingsModalProps {
  onConfirm: (settings: { targetScore: number; timeLimit: number }) => void;
  onCancel: () => void;
  showTimeLimit?: boolean;
}

const SCORE_OPTIONS = [500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500]
  .map(v => ({ value: v, label: `${v}점` }));
const TIME_OPTIONS = [15, 20, 25, 30, 35, 40, 45]
  .map(v => ({ value: v, label: `${v}초` }));

const SettingsModal = memo<SettingsModalProps>(({ onConfirm, onCancel, showTimeLimit = true }) => {
  const scoreRef = useRef(1000);
  const timeRef = useRef(30);

  const handleConfirm = useCallback(() => {
    onConfirm({
      targetScore: scoreRef.current,
      timeLimit: timeRef.current,
    });
  }, [onConfirm]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  }, [onCancel]);

  return (
    <div className="settings-overlay" onClick={handleOverlayClick}>
      <div className="settings-modal">
        <h2>방 설정</h2>

        <div className="settings-field">
          <label>목표 점수</label>
          <CustomSelect
            options={SCORE_OPTIONS}
            defaultValue={1000}
            onChangeRef={scoreRef}
          />
        </div>

        {showTimeLimit && (
          <div className="settings-field">
            <label>턴 시간 제한</label>
            <CustomSelect
              options={TIME_OPTIONS}
              defaultValue={30}
              onChangeRef={timeRef}
            />
          </div>
        )}

        <div className="settings-actions">
          <button className="settings-btn-cancel" onClick={onCancel}>취소</button>
          <button className="settings-btn-confirm" onClick={handleConfirm}>확인</button>
        </div>
      </div>
    </div>
  );
});

interface LobbyProps {
  roomList?: any[];
  getRooms?: () => void;
  onJoin: (nickname: string, roomId: string) => void;
  onCreate: (nickname: string, settings?: { targetScore: number; timeLimit: number }) => void;
  onSoloTest: (nickname: string, settings?: { targetScore: number; timeLimit: number }) => void;
}

export const Lobby: React.FC<LobbyProps> = ({ roomList = [], getRooms, onJoin, onCreate, onSoloTest }) => {
  const {
    isAuthenticated,
    authError,
    authSuccess,
    wins,
    losses,
    login,
    register,
    logout,
    clearAuthMessages,
    getUserStats
  } = useGameStore();

  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [regNicknameInput, setRegNicknameInput] = useState('');

  const [nickname, setNickname] = useState(() => localStorage.getItem('tichu_nickname') || '');
  const [roomId, setRoomId] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [pendingAction, setPendingAction] = useState<'CREATE' | 'SOLO' | null>(null);

  // Sync nickname with localStorage when authenticated, and fetch user stats
  React.useEffect(() => {
    if (isAuthenticated) {
      setNickname(localStorage.getItem('tichu_nickname') || '');
      getUserStats();
    } else {
      setNickname('');
    }
  }, [isAuthenticated, getUserStats]);

  // Clear messages when switching register/login tabs
  React.useEffect(() => {
    clearAuthMessages();
  }, [isRegisterMode, clearAuthMessages]);

  // 로비 화면에 들어오면 항상 방 목록을 최신 상태로 새로고침
  React.useEffect(() => {
    if (getRooms && isAuthenticated) {
      getRooms();
    }
  }, [getRooms, isAuthenticated]);

  const handleOpenSettings = useCallback((action: 'CREATE' | 'SOLO') => {
    setPendingAction(action);
    setShowSettings(true);
  }, []);

  const handleConfirmSettings = useCallback((settings: { targetScore: number; timeLimit: number }) => {
    setShowSettings(false);
    if (pendingAction === 'CREATE') {
      onCreate(nickname, settings);
    } else if (pendingAction === 'SOLO') {
      onSoloTest(nickname || 'Tester', settings);
    }
  }, [pendingAction, nickname, onCreate, onSoloTest]);

  const handleCancelSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegisterMode) {
      register(usernameInput, passwordInput, regNicknameInput);
    } else {
      login(usernameInput, passwordInput);
    }
  };

  return (
    <div className="lobby-container">
      {showSettings && (
        <SettingsModal
          onConfirm={handleConfirmSettings}
          onCancel={handleCancelSettings}
          showTimeLimit={pendingAction !== 'SOLO'}
        />
      )}

      <h1>Tichu Online</h1>

      {!isAuthenticated ? (
        <div className="lobby-box">
          <div className="auth-tabs">
            <button 
              className={`auth-tab ${!isRegisterMode ? 'active' : ''}`}
              onClick={() => setIsRegisterMode(false)}
            >
              로그인
            </button>
            <button 
              className={`auth-tab ${isRegisterMode ? 'active' : ''}`}
              onClick={() => setIsRegisterMode(true)}
            >
              회원가입
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="auth-form">
            <input
              type="text"
              placeholder="아이디"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="비밀번호"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              required
            />
            {isRegisterMode && (
              <input
                type="text"
                placeholder="닉네임"
                value={regNicknameInput}
                onChange={(e) => setRegNicknameInput(e.target.value)}
                required
              />
            )}

            {authError && <div className="auth-msg error">{authError}</div>}
            {authSuccess && <div className="auth-msg success">{authSuccess}</div>}

            <div className="lobby-actions" style={{ marginTop: '0.5rem' }}>
              <button type="submit">
                {isRegisterMode ? '가입 완료' : '로그인'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          <div className="lobby-box">
            <div className="profile-box">
              <span><strong>{nickname}</strong> 님 (<strong>{wins}승 {losses}패</strong>)</span>
              <button className="logout-btn" onClick={logout}>로그아웃</button>
            </div>

            <div className="lobby-actions">
              <button
                disabled={!nickname}
                onClick={() => handleOpenSettings('CREATE')}
              >
                방 만들기
              </button>

              <div className="join-box">
                <input
                  type="text"
                  placeholder="방 번호"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                />
                <button
                  disabled={!nickname || !roomId}
                  onClick={() => onJoin(nickname, roomId)}
                >
                  참가하기
                </button>
              </div>
            </div>
          </div>

          <div className="solo-action" style={{ marginBottom: '20px' }}>
            <button
              disabled={!nickname}
              onClick={() => handleOpenSettings('SOLO')}
            >
              빠른 테스트 (봇 3명 추가)
            </button>
          </div>

          <div className="room-list-container lobby-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0, color: 'white' }}>현재 열려있는 방</h3>
              <button onClick={() => getRooms && getRooms()} style={{ padding: '5px 10px', fontSize: '0.9rem', backgroundColor: '#2c3e50', border: '1px solid #1abc9c', borderRadius: '5px', color: '#1abc9c', cursor: 'pointer' }}>새로고침</button>
            </div>
            
            {roomList.length === 0 ? (
              <p style={{ color: '#bdc3c7', textAlign: 'center', margin: '20px 0' }}>개설된 방이 없습니다.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '200px', overflowY: 'auto' }}>
                {roomList.map(room => {
                  const myUserId = getUserId();
                  const isDisconnectedMe = room.disconnectedUserIds?.includes(myUserId);
                  const canJoin = isDisconnectedMe || (room.playerCount < 4 && room.phase === 'WAITING');
                  
                  let btnText = '참여';
                  let btnColor = '#2ecc71';
                  
                  if (isDisconnectedMe) {
                    btnText = '재연결';
                    btnColor = '#f39c12';
                  } else if (room.playerCount >= 4) {
                    btnText = '만원';
                    btnColor = '#7f8c8d';
                  } else if (room.phase !== 'WAITING') {
                    btnText = '진행 중';
                    btnColor = '#7f8c8d';
                  }

                  return (
                    <div key={room.roomId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#2c3e50', padding: '12px 15px', borderRadius: '8px' }}>
                      <div>
                        <div style={{ color: '#ecf0f1', fontWeight: 'bold', fontSize: '1.1rem' }}>
                          {room.roomName || `방 ${room.roomId}`}
                        </div>
                        <div style={{ color: '#bdc3c7', fontSize: '0.85rem', marginTop: '4px' }}>
                          인원: {room.playerCount}/4 
                          {room.activePlayerCount < room.playerCount && <span style={{ color: '#e74c3c' }}> (오프라인 {room.playerCount - room.activePlayerCount}명)</span>}
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          const reconnectNickname = isDisconnectedMe 
                            ? (localStorage.getItem('tichu_nickname') || nickname || 'Player') 
                            : nickname;
                          onJoin(reconnectNickname, room.roomId);
                        }}
                        disabled={!isDisconnectedMe && (!nickname || !canJoin)}
                        style={{ 
                          padding: '8px 12px', 
                          backgroundColor: (isDisconnectedMe || canJoin) ? btnColor : '#7f8c8d',
                          color: 'white', border: 'none', borderRadius: '5px', cursor: (!isDisconnectedMe && (!nickname || !canJoin)) ? 'not-allowed' : 'pointer' 
                        }}
                      >
                        {btnText}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
