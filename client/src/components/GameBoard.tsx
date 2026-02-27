import React, { useState } from 'react';
import { CardComponent } from './Card';
import { useGameStore } from '../store/useGameStore';
import './GameBoard.css';

export const GameBoard: React.FC = () => {
  const { gameState, socket, passCards, answerGrandTichu } = useGameStore();
  const [passingTargets, setPassingTargets] = useState<{ [targetId: string]: string }>({});
  const [activeTarget, setActiveTarget] = useState<string | null>(null);

  if (!gameState || !socket) return null;

  const me = gameState.players.find((p: any) => p.id === socket.id);
  if (!me) return <div>소켓 연결 확인 중...</div>;

  const suitOrder: Record<string, number> = { 'Jade': 1, 'Sword': 2, 'Pagoda': 3, 'Star': 4, 'Special': 5 };
  
  const sortedHand = [...me.hand].sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    return suitOrder[a.suit] - suitOrder[b.suit];
  });

  const otherPlayers = gameState.players.filter((p: any) => p.id !== socket.id);
  
  // Sort other players by seat relative to me
  const sortedOthers = [...otherPlayers].sort((a, b) => {
    const seatA = (a.seat - me.seat + 4) % 4;
    const seatB = (b.seat - me.seat + 4) % 4;
    return seatA - seatB;
  });

  const handleCardClick = (cardId: string) => {
    if (gameState.phase === 'PASSING' && activeTarget) {
      // Check if this card is already assigned to someone else
      const currentAssignee = Object.keys(passingTargets).find(key => passingTargets[key] === cardId);
      
      const newTargets = { ...passingTargets };
      
      if (currentAssignee) {
        // If assigned to someone else, remove it from them
        delete newTargets[currentAssignee];
      }
      
      // Assign to current active target
      newTargets[activeTarget] = cardId;
      setPassingTargets(newTargets);
      setActiveTarget(null); // Deselect target after picking a card
    } else if (gameState.phase === 'PASSING' && !activeTarget) {
      // If no target selected but card clicked, check if it's assigned to remove it
       const currentAssignee = Object.keys(passingTargets).find(key => passingTargets[key] === cardId);
       if (currentAssignee) {
         const newTargets = { ...passingTargets };
         delete newTargets[currentAssignee];
         setPassingTargets(newTargets);
       }
    }
  };

  const handlePass = () => {
    if (Object.keys(passingTargets).length !== 3) return;
    passCards(passingTargets);
  };

  const hasAlreadyPassed = Object.keys(gameState.passStates[me.id] || {}).length === 3;

  const getTargetName = (id: string) => {
    if (id === sortedOthers[0].id) return '왼쪽 (적)';
    if (id === sortedOthers[1].id) return '마주본 (팀)';
    if (id === sortedOthers[2].id) return '오른쪽 (적)';
    return '';
  };

  return (
    <div className="game-board">
      <div className="opponents">
        {sortedOthers.map((p: any, idx) => (
          <div key={p.id} className={`other-player pos-${idx} ${p.tichuState === 'GRAND' ? 'called-grand' : ''}`}>
            <div className="player-info">
              {p.nickname} ({p.team}팀)
              {p.tichuState === 'GRAND' && <div className="grand-badge">👑 라지 티츄</div>}
              <div className="card-count">🎴 {p.hand.length}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="center-area">
        {gameState.phase === 'WAITING' && (
          <div className="waiting-ui">
            <h2>방 번호: {gameState.roomId}</h2>
            <p>대기 중... ({gameState.players.length}/4명)</p>
            <p>4명이 모두 모이면 게임이 시작됩니다.</p>
          </div>
        )}

        {gameState.phase === 'GRAND_TICHU' && (
          <div className="passing-ui">
            <h3>라지 티츄를 선언하시겠습니까? (현재 8장)</h3>
            {me.tichuState !== null ? (
              <p>다른 플레이어의 대답을 기다리는 중입니다... (현재 {me.hand.length}장)</p>
            ) : (
              <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', marginTop: '20px' }}>
                <button onClick={() => answerGrandTichu(true)} style={{ backgroundColor: '#e74c3c' }}>라지 티츄 선언 (+200)</button>
                <button onClick={() => answerGrandTichu(false)} style={{ backgroundColor: '#95a5a6' }}>패스</button>
              </div>
            )}
          </div>
        )}

        {gameState.phase === 'PASSING' && (
          <div className="passing-ui">
            <h3>선물할 카드를 1장씩 선택해주세요</h3>
            {hasAlreadyPassed ? (
              <p>다른 플레이어를 기다리는 중입니다...</p>
            ) : (
              <div className="passing-targets">
                {sortedOthers.map((p: any) => (
                  <div 
                    key={p.id} 
                    className={`target-slot ${activeTarget === p.id ? 'active' : ''} ${passingTargets[p.id] ? 'filled' : ''}`}
                    onClick={() => setActiveTarget(activeTarget === p.id ? null : p.id)}
                  >
                    <span>{getTargetName(p.id)}</span>
                    <div className="slot-indicator">
                      {passingTargets[p.id] ? '✅ 선택됨' : (activeTarget === p.id ? '👉 카드 고르기' : '클릭해서 대상 선택')}
                    </div>
                  </div>
                ))}
                
                <button 
                  disabled={Object.keys(passingTargets).length !== 3} 
                  onClick={handlePass}
                  className="pass-btn"
                >
                  카드 보내기 (3장)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="my-area">
        <div className="my-status">
          {me.tichuState === 'GRAND' && <div className="grand-badge-self">👑 라지 티츄</div>}
        </div>
        <div className="my-hand">
          {sortedHand.map((card: any) => {
            const isAssigned = Object.values(passingTargets).includes(card.id);
            const assigneeId = Object.keys(passingTargets).find(key => passingTargets[key] === card.id);
            
            return (
              <div key={card.id} className="card-wrapper">
                {isAssigned && assigneeId && (
                  <div className="card-badge">{getTargetName(assigneeId)}</div>
                )}
                <CardComponent 
                  suit={card.suit}
                  value={card.value}
                  id={card.id}
                  isSelected={isAssigned}
                  onClick={() => handleCardClick(card.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
