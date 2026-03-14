import React, { useState, useCallback, useRef, memo } from 'react';
import './Lobby.css';
import { CustomSelect } from './CustomSelect';

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
  onJoin: (nickname: string, roomId: string) => void;
  onCreate: (nickname: string, settings?: { targetScore: number; timeLimit: number }) => void;
  onSoloTest: (nickname: string, settings?: { targetScore: number; timeLimit: number }) => void;
}

export const Lobby: React.FC<LobbyProps> = ({ onJoin, onCreate, onSoloTest }) => {
  const [nickname, setNickname] = useState('');
  const [roomId, setRoomId] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [pendingAction, setPendingAction] = useState<'CREATE' | 'SOLO' | null>(null);

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
      <div className="lobby-box">
        <input
          type="text"
          placeholder="닉네임 입력"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />

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

      <div className="solo-action">
        <button
          disabled={!nickname}
          onClick={() => handleOpenSettings('SOLO')}
          style={{ backgroundColor: '#8e44ad' }}
        >
          빠른 테스트 (봇 3명 추가)
        </button>
      </div>
    </div>
  );
};
