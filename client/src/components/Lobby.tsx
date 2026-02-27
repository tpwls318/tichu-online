import React, { useState } from 'react';

interface LobbyProps {
  onJoin: (nickname: string, roomId: string) => void;
  onCreate: (nickname: string) => void;
  onSoloTest: (nickname: string) => void;
}

export const Lobby: React.FC<LobbyProps> = ({ onJoin, onCreate, onSoloTest }) => {
  const [nickname, setNickname] = useState('');
  const [roomId, setRoomId] = useState('');

  return (
    <div className="lobby-container">
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
            onClick={() => onCreate(nickname)}
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
          onClick={() => onSoloTest(nickname || 'Tester')}
          style={{ backgroundColor: '#8e44ad' }}
        >
          빠른 테스트 (봇 3명 추가)
        </button>
      </div>
    </div>
  );
};
