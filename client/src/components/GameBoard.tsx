import React, { useState, useEffect, useRef } from 'react';
import { CardComponent } from './Card';
import { useGameStore } from '../store/useGameStore';
import './GameBoard.css';

export const GameBoard: React.FC = () => {
  const { gameState, socket, passCards, answerGrandTichu, playCards, passTrick } = useGameStore();
  const [passingTargets, setPassingTargets] = useState<{ [targetId: string]: string }>({});
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [showReceived, setShowReceived] = useState(false);
  const hasShownReceived = useRef(false);
  const [selectedPlayCards, setSelectedPlayCards] = useState<string[]>([]);
  const [activeEvent, setActiveEvent] = useState<any | null>(null);
  const [showWishPrompt, setShowWishPrompt] = useState(false);
  const [delayedLastTrick, setDelayedLastTrick] = useState<any | null>(null);

  // 트릭이 비워질 때 잠시 동안 바닥에 남겨서 보여주기 위한 효과
  useEffect(() => {
    if (gameState?.lastTrick) {
      setDelayedLastTrick(gameState.lastTrick);
    } else if (!gameState?.lastTrick && delayedLastTrick) {
      // 내가 낸 카드로 인해 트릭이 종료된 경우(내 턴에서 모두 패스) 딜레이 생략
      if (delayedLastTrick.playerId === socket?.id) {
        setDelayedLastTrick(null);
      } else {
        const timer = setTimeout(() => {
          setDelayedLastTrick(null);
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [gameState?.lastTrick, socket?.id, delayedLastTrick]);

  useEffect(() => {
    if (gameState?.phase === 'GRAND_TICHU' || gameState?.phase === 'WAITING') {
      setPassingTargets({});
      setActiveTarget(null);
    }
  }, [gameState?.phase]);

  if (!gameState || !socket) return null;

  const me = gameState.players.find((p: any) => p.id === socket.id);
  if (!me) return <div>소켓 연결 확인 중...</div>;

  // Initialize showReceived when data arrives (only once per PLAYING phase)
  useEffect(() => {
    if (gameState?.phase === 'PLAYING' && gameState.receivedPasses && gameState.receivedPasses[me?.id] && !hasShownReceived.current) {
      setShowReceived(true);
      hasShownReceived.current = true;
    } else if (gameState?.phase !== 'PLAYING') {
      setShowReceived(false);
      hasShownReceived.current = false;
    }
  }, [gameState?.phase, gameState?.receivedPasses, me?.id]);

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

  // Debug: Show bot hands in console
  useEffect(() => {
    if (gameState && otherPlayers.every((p: any) => p.hand.length === 14)) {
      console.log("=== BOTS/OPPONENTS HANDS ===");
      sortedOthers.forEach((p: any) => {
        const sortedBotHand = [...p.hand].sort((a: any, b: any) => {
          if (a.value !== b.value) return a.value - b.value;
          return suitOrder[a.suit] - suitOrder[b.suit];
        });
        const handStr = sortedBotHand.map((c: any) => c.value === 11 ? 'J' : c.value === 12 ? 'Q' : c.value === 13 ? 'K' : c.value === 14 ? 'A' : c.value.toString()).join(', ');
        console.log(`${getTargetName(p.id)} [${p.team}팀]: ${handStr}`);
      });
      console.log("============================");
    }
  }, [gameState?.players, gameState?.phase]);

  useEffect(() => {
    if (gameState?.cardEvent) {
      setActiveEvent(gameState.cardEvent);
      // We explicitly do NOT clear the timeout here when gameState.cardEvent becomes null.
      // The server clears the event immediately when the next player moves, but the 
      // client still needs to finish the 2.5s animation before letting the user play.
      setTimeout(() => {
        setActiveEvent(null);
      }, gameState.cardEvent.duration || 2500);
    }
  }, [gameState?.cardEvent]);

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
    } else if (gameState.phase === 'PLAYING') {
      if (selectedPlayCards.includes(cardId)) {
        setSelectedPlayCards(prev => prev.filter(id => id !== cardId));
      } else {
        setSelectedPlayCards(prev => [...prev, cardId]);
      }
    }
  };

  const handlePlaySubmit = () => {
    if (selectedPlayCards.length === 0) return;
    
    // Check if hand contains Sparrow (value 1)
    const hasSparrow = selectedPlayCards.some(id => {
      const card = me.hand.find((c: any) => c.id === id);
      return card && card.value === 1;
    });

    if (hasSparrow) {
      setShowWishPrompt(true);
      return;
    }

    playCards(selectedPlayCards);
    setSelectedPlayCards([]);
  };

  const submitPlayWithWish = (wishValue?: number) => {
    playCards(selectedPlayCards, wishValue);
    setSelectedPlayCards([]);
    setShowWishPrompt(false);
  };

  const handlePassTrick = () => {
    passTrick();
    setSelectedPlayCards([]);
  };

  const isBomb = (cardIds: string[]) => {
    if (cardIds.length < 4) return false;
    const cards = cardIds.map(id => me.hand.find((c: any) => c.id === id)).filter(Boolean);
    if (cards.length !== cardIds.length) return false;
    
    // Check Quartet
    if (cards.length === 4) {
      const val = cards[0].value;
      if (cards.every(c => c.value === val)) return true;
    }

    // Check Straight Flush
    if (cards.length >= 5) {
      const sorted = [...cards].sort((a, b) => a.value - b.value);
      const suit = sorted[0].suit;
      let isSF = true;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].suit !== suit || sorted[i].value !== sorted[i-1].value + 1) {
          isSF = false;
          break;
        }
      }
      if (isSF) return true;
    }
    return false;
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
    <div className="game-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', backgroundColor: '#141E26' }}>
      {/* 🚀 상단 공통 Top Bar (스코어 및 부가 기능) */}
      <div className="game-top-bar" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 20px', backgroundColor: '#0B1015', borderBottom: '1px solid #2C3E50', color: 'white', zIndex: 200
      }}>
        <div className="scoreboard-ui" style={{
          display: 'flex', gap: '20px', fontWeight: 'bold', fontSize: '1.1rem'
        }}>
          <div style={{ color: me.team === 'A' ? '#f1c40f' : '#ecf0f1' }}>A팀: {gameState.scores.teamA}점</div>
          <div style={{ color: me.team === 'B' ? '#f1c40f' : '#ecf0f1' }}>B팀: {gameState.scores.teamB}점</div>
        </div>
        
        {/* 설정 정보 및 방 번호 표시 */}
        <div className="top-bar-actions" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.9rem', color: '#95a5a6' }}>목표: {gameState.settings?.targetScore || 1000}점</span>
          <span style={{ fontSize: '0.9rem', color: '#95a5a6' }}>턴 시간: {gameState.settings?.timeLimit || 30}초</span>
          <span style={{ fontSize: '0.9rem', color: '#95a5a6', borderLeft: '1px solid #455a64', paddingLeft: '15px' }}>방 번호: {gameState.roomId}</span>
        </div>
      </div>

      {/* 라운드 결과 오버레이 */}
      {gameState.phase === 'FINISHED' && gameState.roundResult && (() => {
        const targetScore = gameState.settings?.targetScore || 1000;
        const aWon = gameState.scores.teamA >= targetScore;
        const bWon = gameState.scores.teamB >= targetScore;
        const gameEnded = aWon || bWon;

        let resultMessage = gameState.roundResult.message;
        if (gameEnded) {
          const myTeamWon = (aWon && me.team === 'A') || (bWon && me.team === 'B');
          if (myTeamWon) {
             resultMessage = `🏆 우리 팀이 ${targetScore}점 이상을 달성하여 승리했습니다!`;
          } else {
             resultMessage = `💀 상대 팀이 ${targetScore}점 이상을 달성하여 패배했습니다.`;
          }
        }

        const myColor = '#3498db';
        const oppColor = '#e74c3c';
        const teamAColor = me.team === 'A' ? myColor : oppColor;
        const teamBColor = me.team === 'B' ? myColor : oppColor;
        const teamAName = me.team === 'A' ? 'A팀(우리)' : 'A팀(상대)';
        const teamBName = me.team === 'B' ? 'B팀(우리)' : 'B팀(상대)';

        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 500
          }}>
            <div style={{
              backgroundColor: '#2c3e50', padding: '40px', borderRadius: '16px',
              textAlign: 'center', color: 'white', minWidth: '360px'
            }}>
              <h2 style={{ margin: '0 0 20px 0', fontSize: '1.5rem', color: gameEnded ? '#f1c40f' : 'white' }}>
                {resultMessage}
              </h2>
              
              <div style={{ marginBottom: '20px', width: '100%' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid #34495e', paddingBottom: '10px', marginBottom: '10px', fontWeight: 'bold', color: '#95a5a6' }}>
                  <div style={{ flex: 1, textAlign: 'left' }}>Round</div>
                  <div style={{ flex: 1, textAlign: 'center', color: teamAColor }}>{teamAName}</div>
                  <div style={{ flex: 1, textAlign: 'center', color: teamBColor }}>{teamBName}</div>
                </div>
                
                {gameState.roundHistory?.map((historyResult: any, index: number) => (
                  <div key={index} style={{ display: 'flex', padding: '6px 0' }}>
                    <div style={{ flex: 1, textAlign: 'left', color: '#bdc3c7' }}>{index + 1}R</div>
                    <div style={{ flex: 1, textAlign: 'center', color: teamAColor }}>
                      {historyResult.teamA}
                    </div>
                    <div style={{ flex: 1, textAlign: 'center', color: teamBColor }}>
                      {historyResult.teamB}
                    </div>
                  </div>
                ))}
                
                <div style={{ display: 'flex', paddingTop: '10px', marginTop: '10px', borderTop: '1px solid #34495e', fontWeight: 'bold', fontSize: '1.2rem' }}>
                  <div style={{ flex: 1, textAlign: 'left', color: '#95a5a6' }}>Total</div>
                  <div style={{ flex: 1, textAlign: 'center', color: teamAColor }}>{gameState.roundResult?.teamATotal}</div>
                  <div style={{ flex: 1, textAlign: 'center', color: teamBColor }}>{gameState.roundResult?.teamBTotal}</div>
                </div>
              </div>

              {/* 승리 조건 달성 시 '다음 라운드' 문구 숨김 */}
              {!gameEnded && (
                <div style={{ fontSize: '0.85rem', color: '#7f8c8d' }}>잠시 후 다음 라운드가 시작됩니다...</div>
              )}
            </div>
          </div>
        );
      })()}

      <div className="game-board" style={{ flex: 1, height: '100%' }}>
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

        {(gameState.phase === 'PLAYING' || gameState.phase === 'FINISHED') && (
          <div className="playing-ui" style={{ textAlign: 'center', color: 'white', position: 'relative', width: '100%', height: '100%' }}>
            {showReceived && gameState.receivedPasses?.[me.id] ? (
              <div className="received-cards-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'rgba(26, 37, 47, 0.95)', padding: '30px', borderRadius: '15px', zIndex: 1000, boxShadow: '0 10px 30px rgba(0,0,0,0.8)', border: '2px solid #2ecc71', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '90%', maxWidth: '400px' }}>
                <h3 style={{ color: '#2ecc71', marginBottom: '20px' }}>선물 교환 완료! (받은 카드)</h3>
                <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', marginBottom: '30px', width: '100%' }}>
                  {Object.entries(gameState.receivedPasses[me.id]).map(([fromId, card]: [string, any]) => {
                    const sender = gameState.players.find((p: any) => p.id === fromId);
                    return (
                      <div key={card.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ marginBottom: '10px', fontSize: '0.9rem', color: '#f1c40f' }}>
                          {sender?.nickname}에게서
                        </div>
                        <CardComponent suit={card.suit} value={card.value} id={card.id} isSelected={false} onClick={() => {}} />
                      </div>
                    );
                  })}
                </div>
                <button 
                  onClick={() => setShowReceived(false)}
                  style={{ padding: '12px 40px', backgroundColor: '#2ecc71', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold', width: '100%', maxWidth: '200px', marginTop: '10px' }}
                >
                  확인
                </button>
              </div>
            ) : activeEvent?.type === 'Dog' ? (
              <div className="dog-event-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', animation: 'fadeIn 0.3s ease-out', zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.85)', padding: '40px', borderRadius: '20px', border: '2px solid #e67e22' }}>
                <h2 style={{ fontSize: '3rem', marginBottom: '10px' }}>🐶 왈왈!</h2>
                <h3 style={{ color: '#e67e22', fontSize: '1.5rem' }}>개가 플레이되었습니다!</h3>
                <p style={{ marginTop: '20px', fontSize: '1.2rem' }}>
                  턴이 <strong>{gameState.players.find((p: any) => p.seat === activeEvent.targetSeat)?.nickname}</strong> 님에게 넘어갑니다!
                </p>
              </div>
            ) : gameState.cardEvent?.type === 'DragonGiveaway' && gameState.currentTurn === me.seat ? (
              <div className="dragon-event-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', backgroundColor: 'rgba(26, 37, 47, 0.95)', padding: '30px', borderRadius: '15px', zIndex: 1000, border: '2px solid #e74c3c', boxShadow: '0 10px 30px rgba(0,0,0,0.8)', width: '90%', maxWidth: '400px' }}>
                <h3 style={{ color: '#e74c3c', fontSize: '1.5rem', marginBottom: '20px' }}>🐉 용이 끝났습니다! 트릭을 누구에게 주시겠습니까?</h3>
                <div style={{ display: 'flex', gap: '20px', justifyContent: 'center' }}>
                  {sortedOthers.filter((p: any) => p.team !== me.team).map((p: any) => (
                    <button 
                      key={p.id}
                      onClick={() => useGameStore.getState().giveDragonTrick(p.id)}
                      style={{ padding: '12px 20px', backgroundColor: '#e67e22', color: 'white', border: 'none', borderRadius: '5px', fontSize: '1.1rem', cursor: 'pointer', flex: 1 }}
                    >
                      {p.nickname} ({getTargetName(p.id)})
                    </button>
                  ))}
                </div>
              </div>
            ) : activeEvent?.type === 'DragonReceived' ? (
              <div className="dragon-event-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', backgroundColor: 'rgba(26, 37, 47, 0.95)', padding: '30px', borderRadius: '15px', zIndex: 1000, border: '2px solid #3498db', boxShadow: '0 10px 30px rgba(0,0,0,0.8)' }}>
                <h2 style={{ color: '#3498db', fontSize: '1.5rem', marginBottom: '10px' }}>🎁 용의 선물!</h2>
                <p style={{ color: 'white', fontSize: '1.2rem', margin: 0 }}>
                  <strong>{gameState.players.find((p: any) => p.seat === activeEvent.fromSeat)?.nickname}</strong> 님이 <strong>{gameState.players.find((p: any) => p.seat === activeEvent.targetSeat)?.nickname}</strong> 님에게 트릭 더미를 넘겨주었습니다!
                </p>
              </div>
            ) : showWishPrompt ? (
              <div className="wish-prompt-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', backgroundColor: 'rgba(26, 37, 47, 0.95)', padding: '30px', borderRadius: '15px', zIndex: 1000, border: '2px solid #f1c40f', boxShadow: '0 10px 30px rgba(0,0,0,0.8)', width: '90%', maxWidth: '400px' }}>
                <h3 style={{ color: '#f1c40f', marginBottom: '20px' }}>🐦 참새의 소원: 원하는 숫자를 선택하세요</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', maxWidth: '400px', margin: '0 auto' }}>
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(val => {
                    const label = val === 11 ? 'J' : val === 12 ? 'Q' : val === 13 ? 'K' : val === 14 ? 'A' : val.toString();
                    return (
                      <button 
                        key={val}
                        onClick={() => submitPlayWithWish(val)}
                        style={{ padding: '10px 15px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '5px', fontSize: '1.1rem', cursor: 'pointer' }}
                      >
                        {label}
                      </button>
                    );
                  })}
                  <button 
                    onClick={() => submitPlayWithWish(undefined)}
                    style={{ padding: '10px 15px', backgroundColor: '#95a5a6', color: 'white', border: 'none', borderRadius: '5px', fontSize: '1.1rem', cursor: 'pointer', width: '100%', marginTop: '10px' }}
                  >
                    요구하지 않음
                  </button>
                  <button 
                    onClick={() => setShowWishPrompt(false)}
                    style={{ padding: '10px 15px', backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '5px', fontSize: '1.1rem', cursor: 'pointer', width: '100%', marginTop: '10px' }}
                  >
                    취소 (다시 고르기)
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                  현재 턴: {gameState.players.find((p: any) => p.seat === gameState.currentTurn)?.nickname}
                  {gameState.currentWish && <span style={{ marginLeft: '10px', color: '#f1c40f' }}>🐦 현재 소원: {
                    gameState.currentWish === 11 ? 'J' : gameState.currentWish === 12 ? 'Q' : gameState.currentWish === 13 ? 'K' : gameState.currentWish === 14 ? 'A' : gameState.currentWish
                  }</span>}
                </div>
                
                {/* 트릭(현재 깔린 패) 표시 영역 */}
                <div className="current-trick" style={{ minHeight: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {delayedLastTrick ? (
                    <>
                      <div style={{ marginBottom: '10px', color: '#f1c40f' }}>
                        {gameState.players.find((p: any) => p.id === delayedLastTrick?.playerId)?.nickname}의 {delayedLastTrick.type}
                      </div>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        {delayedLastTrick.cards.map((card: any) => (
                           <div key={card.id} style={{ width: '60px', height: '85px' }}>
                             <CardComponent suit={card.suit} value={card.value} id={card.id} isSelected={false} disableHover={true} onClick={() => {}} />
                           </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ color: '#aaa', fontStyle: 'italic', paddingTop: '40px' }}>
                      {gameState.currentTurn === me.seat ? '바닥에 깔린 카드가 없습니다. 주도권을 쥐고 있습니다!' : '새로운 트릭이 시작됩니다. 시작 플레이를 기다리는 중...'}
                    </div>
                  )}
                </div>

                {/* 내 턴이거나 폭탄을 들고 있을 때 컨트롤 표시 (게임 중일 때만) */}
                {gameState.phase === 'PLAYING' && (gameState.currentTurn === me.seat || (selectedPlayCards.length >= 4 && isBomb(selectedPlayCards))) && (
                  <div className="play-controls" style={{ display: 'flex', gap: '15px', marginTop: '20px', marginBottom: '20px', zIndex: 10, position: 'relative' }}>
                    <button 
                      className="play-btn" 
                      style={{ 
                        padding: '10px 20px', 
                        backgroundColor: (gameState.currentTurn !== me.seat && isBomb(selectedPlayCards)) ? '#e74c3c' : '#3498db', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '5px', 
                        fontSize: '1.1rem', 
                        cursor: selectedPlayCards.length > 0 ? 'pointer' : 'not-allowed', 
                        opacity: selectedPlayCards.length > 0 ? 1 : 0.5 
                      }}
                      onClick={handlePlaySubmit}
                      disabled={selectedPlayCards.length === 0}
                    >
                      {(gameState.currentTurn !== me.seat && isBomb(selectedPlayCards)) ? `🧨 폭탄 난입 (${selectedPlayCards.length}장)` : `제출 (${selectedPlayCards.length}장)`}
                    </button>
                    {gameState.currentTurn === me.seat && (
                      <button 
                        className="pass-btn"
                        style={{ padding: '10px 20px', backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '5px', fontSize: '1.1rem', cursor: 'pointer' }}
                        onClick={handlePassTrick}
                      >
                        패스
                      </button>
                    )}
                  </div>
                )}
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
            const isAssigned = gameState.phase === 'PASSING' ? Object.values(passingTargets).includes(card.id) : selectedPlayCards.includes(card.id);
            const assigneeId = gameState.phase === 'PASSING' ? Object.keys(passingTargets).find(key => passingTargets[key] === card.id) : null;
            
            return (
              <div key={card.id} className="card-wrapper" style={{ transform: isAssigned && gameState.phase === 'PLAYING' ? 'translateY(-15px)' : 'none', transition: 'transform 0.1s ease' }}>
                {isAssigned && assigneeId && (
                  <div className="card-badge">{getTargetName(assigneeId)}</div>
                )}
                <CardComponent 
                  suit={card.suit}
                  value={card.value}
                  id={card.id}
                  isSelected={false} // Selection visual is handled by translateY above and existing scale for hover
                  onClick={() => handleCardClick(card.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
};
