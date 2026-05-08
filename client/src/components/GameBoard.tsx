import React, { useState, useEffect, useRef } from 'react';
import { CardComponent } from './Card';
import { HandValidator } from '../utils/validator';
import { useGameStore } from '../store/useGameStore';
import './GameBoard.css';

export const GameBoard: React.FC = () => {
  const { gameState, socket, passCards, answerGrandTichu, playCards, passTrick, toggleReady, callSmallTichu, playAgain, leaveRoom, updateNickname, needsNickname, setNeedsNickname } = useGameStore();
  const [passingTargets, setPassingTargets] = useState<{ [targetId: string]: string }>({});
  const [showReceived, setShowReceived] = useState(false);
  const hasShownReceived = useRef(false);
  const [selectedPlayCards, setSelectedPlayCards] = useState<string[]>([]);
  const [pendingPassCard, setPendingPassCard] = useState<string | null>(null);
  const [activeEvent, setActiveEvent] = useState<any | null>(null);
  const [showWishPrompt, setShowWishPrompt] = useState(false);
  const [delayedLastTrick, setDelayedLastTrick] = useState<any | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  const [tempNickname, setTempNickname] = useState(() => localStorage.getItem('tichu_nickname') || '');

  const handleNicknameSubmit = () => {
    if (tempNickname.trim()) {
      updateNickname(tempNickname.trim());
      localStorage.setItem('tichu_nickname', tempNickname.trim());
      setNeedsNickname(false);
    }
  };

  const timeLimit = gameState?.settings?.timeLimit || 30;
  const [timeLeft, setTimeLeft] = useState(timeLimit);

  useEffect(() => {
    if (gameState?.phase === 'PLAYING') {
      setTimeLeft(timeLimit);
    }
  }, [gameState?.currentTurn, gameState?.phase, timeLimit]);

  useEffect(() => {
    if (gameState?.phase !== 'PLAYING') return;
    const timerId = setInterval(() => {
      setTimeLeft((prev: number) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timerId);
  }, [gameState?.phase, gameState?.currentTurn]);

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
      setPendingPassCard(null);
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

  // 타임아웃 시 자동 플레이 로직
  useEffect(() => {
    if (timeLeft === 0 && gameState?.phase === 'PLAYING' && gameState?.currentTurn === me?.seat) {
      if (gameState.cardEvent) return; // 애니메이션 진행 중 대기

      const isFirstTrick = gameState.currentTrickCards?.length === 0;

      // 1. 짹짹이 콜이 존재하고, 낼 수 있다면 해당 패를 자동으로 냄
      if (gameState.currentWish !== null) {
        if (HandValidator.canSatisfyWish(me.hand, gameState.currentWish, gameState.lastTrick)) {
          const wishCards = me.hand.filter((c: any) => c.value === gameState.currentWish).map((c: any) => c.id);
          
          if (!gameState.lastTrick || gameState.lastTrick.type === 'Single') {
            playCards([wishCards[0]]);
            return;
          } else if (gameState.lastTrick.type === 'Pair') {
            playCards(wishCards.slice(0, 2));
            return;
          } else if (gameState.lastTrick.type === 'Triple') {
            playCards(wishCards.slice(0, 3));
            return;
          } else {
             playCards(wishCards.slice(0, 4));
             return;
          }
        }
      }

      // 2. 첫 트릭이라 패스가 불가능할 경우 가장 낮은 카드 1장 자동 제출
      if (isFirstTrick) {
        if (sortedHand.length > 0) {
          playCards([sortedHand[0].id]);
        }
      } else {
        // 3. 그 외의 경우 자동 패스
        passTrick();
        setSelectedPlayCards([]);
      }
    }
  }, [timeLeft, gameState?.phase, gameState?.currentTurn, gameState?.currentTrickCards, gameState?.currentWish, gameState?.lastTrick, me?.seat, me?.hand, sortedHand, playCards, passTrick, gameState?.cardEvent]);


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
    if (gameState.phase === 'PASSING') {
      // 이미 배정된 카드를 다시 클릭하면 배정 해제
      const currentAssignee = Object.keys(passingTargets).find(key => passingTargets[key] === cardId);
      if (currentAssignee) {
        const newTargets = { ...passingTargets };
        delete newTargets[currentAssignee];
        setPassingTargets(newTargets);
        setPendingPassCard(null);
        return;
      }
      // 이미 3장 다 배정됐으면 더 선택 불가
      if (Object.keys(passingTargets).length >= 3) return;
      // 카드를 선택하면 pendingPassCard로 설정 (줄 사람 대기)
      setPendingPassCard(pendingPassCard === cardId ? null : cardId);
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
    
    // 짹짹이 콜(Wish) 검증 로직
    if (gameState.currentWish !== null) {
      const selectedCardsData = me.hand.filter((c: any) => selectedPlayCards.includes(c.id));
      const satisfiesWish = selectedCardsData.some((c: any) => c.value === gameState.currentWish);
      
      if (!satisfiesWish) {
        // 콜을 만족시킬 수 있는지 확인
        const canSatisfy = HandValidator.canSatisfyWish(me.hand, gameState.currentWish, gameState.lastTrick);
        if (canSatisfy) {
          const valueMap: Record<number, string> = {
            2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
            11: 'J', 12: 'Q', 13: 'K', 14: 'A'
          };
          const valStr = valueMap[gameState.currentWish] || gameState.currentWish;
          setPlayError(`짹짹이의 콜(${valStr})을 낼 수 있는 패가 있습니다.\n반드시 포함해서 내야 합니다!`);
          setTimeout(() => setPlayError(null), 3500);
          return; // 제출 차단
        }
      }
    }
    
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
    // 짹짹이 콜(Wish) 검증 로직 (마찬가지로 낼 수 있으면 패스 불가)
    if (gameState.currentWish !== null) {
      const canSatisfy = HandValidator.canSatisfyWish(me.hand, gameState.currentWish, gameState.lastTrick);
      if (canSatisfy) {
        const valueMap: Record<number, string> = {
          2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
          11: 'J', 12: 'Q', 13: 'K', 14: 'A'
        };
        const valStr = valueMap[gameState.currentWish] || gameState.currentWish;
        setPlayError(`짹짹이의 콜(${valStr})을 낼 수 있으므로\n패스할 수 없습니다!`);
        setTimeout(() => setPlayError(null), 3500);
        return; // 패스 차단
      }
    }

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
    if (id === sortedOthers[0].id) return '왼쪽';
    if (id === sortedOthers[1].id) return '마주보는 자리';
    if (id === sortedOthers[2].id) return '오른쪽';
    return '';
  };

  return (
    <div className="game-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', width: '100vw', backgroundColor: '#141E26' }}>
      {/* 🚀 상단 공통 Top Bar (스코어 및 부가 기능) */}
      <div className="game-top-bar" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap',
        padding: '8px 12px', backgroundColor: '#0B1015', borderBottom: '1px solid #2C3E50', color: 'white', zIndex: 200,
        gap: '6px', fontSize: 'clamp(0.7rem, 2vw, 1.1rem)'
      }}>
        <div className="scoreboard-ui" style={{
          display: 'flex', gap: '12px', fontWeight: 'bold'
        }}>
          <div style={{ color: me.team === 'A' ? '#f1c40f' : '#ecf0f1' }}>A팀: {gameState.scores.teamA}점</div>
          <div style={{ color: me.team === 'B' ? '#f1c40f' : '#ecf0f1' }}>B팀: {gameState.scores.teamB}점</div>
        </div>
        
        {/* 설정 정보 및 방 번호 표시 */}
        <div className="top-bar-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: 'clamp(0.65rem, 1.8vw, 0.9rem)' }}>
          <span style={{ color: '#95a5a6' }}>목표: {gameState.settings?.targetScore || 1000}점</span>
          <span style={{ color: '#95a5a6' }}>턴: {gameState.settings?.timeLimit || 30}초</span>
          <span style={{ color: '#95a5a6' }}>방: {gameState.roomName || gameState.roomId}</span>
        </div>
      </div>

      {/* 라운드 결과 오버레이 */}
      {gameState.phase === 'FINISHED' && gameState.roundResult && (() => {
        const isBotGame = gameState.players.some((p: any) => p.id.startsWith('bot'));
        const targetScore = gameState.settings?.targetScore || 1000;
        const aWon = gameState.scores.teamA >= targetScore;
        const bWon = gameState.scores.teamB >= targetScore;
        const isForfeit = gameState.roundResult.message.includes('[기권 패배]');
        const gameEnded = aWon || bWon || isForfeit;

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
            <div className="round-result-overlay" style={{
              backgroundColor: '#2c3e50', padding: '40px', borderRadius: '16px',
              textAlign: 'center', color: 'white', width: '90%', maxWidth: '400px', boxSizing: 'border-box'
            }}>
              <h2 style={{ margin: '0 0 20px 0', fontSize: '1.5rem', color: gameEnded ? '#f1c40f' : 'white', wordBreak: 'keep-all' }}>
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

              {/* 승리 조건 달성 시 '다음 라운드' 문구 숨김, 버튼 노출 */}
              {!gameEnded ? (
                <div style={{ fontSize: '0.85rem', color: '#7f8c8d' }}>잠시 후 다음 라운드가 시작됩니다...</div>
              ) : (
                <div style={{ marginTop: '20px', display: 'flex', gap: '15px', justifyContent: 'center' }}>
                  {isBotGame ? (
                    <>
                      <button 
                        onClick={playAgain}
                        style={{ padding: '12px 24px', backgroundColor: '#2ecc71', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold' }}
                      >
                        다시하기
                      </button>
                      <button 
                        onClick={leaveRoom}
                        style={{ padding: '12px 24px', backgroundColor: '#95a5a6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold' }}
                      >
                        처음화면으로
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        onClick={leaveRoom}
                        style={{ padding: '12px 24px', backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold' }}
                      >
                        처음화면으로 (나가기)
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div className="game-board" style={{ flex: 1, height: '100%' }}>
        {needsNickname && (
          <div 
            onClick={(e) => { if (e.target === e.currentTarget) setNeedsNickname(false); }}
            style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 999999
          }}>
            <div style={{
              backgroundColor: '#2c3e50', padding: '30px', borderRadius: '15px',
              textAlign: 'center', color: 'white', width: '90%', maxWidth: '320px', boxSizing: 'border-box', border: '2px solid #34495e',
              position: 'relative'
            }}>
              <button
                onClick={() => setNeedsNickname(false)}
                style={{ position: 'absolute', top: '10px', right: '10px', background: 'transparent', border: 'none', color: '#95a5a6', fontSize: '1.4rem', cursor: 'pointer', padding: '0', lineHeight: '1' }}
              >✕</button>
              <h2 style={{ marginBottom: '20px', color: '#f1c40f', fontSize: '1.4rem', wordBreak: 'keep-all' }}>사용할 닉네임을 설정해주세요</h2>
              <input 
                type="text" 
                value={tempNickname}
                onChange={(e) => setTempNickname(e.target.value)}
                placeholder="닉네임 입력"
                style={{
                  width: '100%', padding: '12px', borderRadius: '8px', border: 'none',
                  fontSize: '1.2rem', marginBottom: '20px', boxSizing: 'border-box', textAlign: 'center'
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleNicknameSubmit()}
                autoFocus
              />
              <button 
                onClick={handleNicknameSubmit}
                disabled={!tempNickname.trim()}
                style={{
                  width: '100%', padding: '12px', backgroundColor: '#3498db', color: 'white',
                  border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: tempNickname.trim() ? 'pointer' : 'not-allowed',
                  opacity: tempNickname.trim() ? 1 : 0.5, fontWeight: 'bold'
                }}
              >
                설정 완료
              </button>
            </div>
          </div>
        )}

        <div className="opponents">
        {sortedOthers.map((p: any, idx) => (
          <div key={p.id} className={`other-player pos-${idx} ${p.tichuState === 'GRAND' ? 'called-grand' : ''}`} style={{ position: 'relative' }}>
            <div className="player-info" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: p.team === me.team ? '#5aa0e8' : '#e74c3c', fontWeight: 'bold' }}>
                {p.nickname}
                {p.isDisconnected && <span style={{ marginLeft: '4px', color: '#e74c3c', fontSize: '0.8rem' }}>🔴</span>}
              </span>
              {p.tichuState === 'GRAND' && <span className="grand-badge">👑 라지 티츄</span>}
              <div className="card-count" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <img src="/cards/Back.png" alt="card" style={{ width: '14px', height: 'auto', borderRadius: '2px' }} />
                <span>{p.hand.length}</span>
              </div>
            </div>
            {p.seat === gameState.currentTurn && (
              <div style={{ 
                position: 'absolute',
                bottom: '-28px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: '#27ae60', color: 'white', padding: '2px 10px', 
                borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold', 
                whiteSpace: 'nowrap'
              }}>
                현재 차례 <span style={{ color: timeLeft <= 5 ? '#e74c3c' : '#f1c40f' }}>({timeLeft}s)</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="center-area">
        {gameState.phase === 'WAITING' && (
          <div className="waiting-ui game-overlay" style={{ backgroundColor: 'rgba(26, 37, 47, 0.95)', padding: '30px', borderRadius: '15px', textAlign: 'center', minWidth: '350px', border: '2px solid #34495e' }}>
            <h2 style={{ color: '#ecf0f1', marginBottom: '10px' }}>방 번호: {gameState.roomId}</h2>
            <div style={{ marginBottom: '20px' }}>
              <button
                onClick={() => {
                  const inviteLink = `${window.location.origin}/?roomId=${gameState.roomId}`;
                  navigator.clipboard.writeText(inviteLink).then(() => {
                    const btn = document.getElementById('copy-link-btn');
                    if (btn) {
                      const originalText = btn.innerText;
                      btn.innerText = '✅ 복사 완료!';
                      setTimeout(() => { btn.innerText = originalText; }, 2000);
                    }
                  });
                }}
                id="copy-link-btn"
                style={{ padding: '8px 16px', backgroundColor: '#8e44ad', color: 'white', border: 'none', borderRadius: '6px', fontSize: '1rem', cursor: 'pointer', fontWeight: 'bold' }}
              >
                🔗 초대 링크 복사
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '20px 0' }}>
              {gameState.players.map((p: any) => (
                 <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', backgroundColor: '#34495e', borderRadius: '8px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: 'white', fontWeight: 'bold' }}>{p.nickname}</span>
                      {p.id === me?.id && (
                        <button 
                          onClick={() => setNeedsNickname(true)}
                          style={{ padding: '0', backgroundColor: 'transparent', border: 'none', color: '#95a5a6', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          title="닉네임 변경"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>
                        </button>
                      )}
                    </div>
                    <span style={{ color: p.isReady ? '#2ecc71' : '#e74c3c', fontWeight: 'bold' }}>{p.isReady ? '레디 완료' : '준비 중'}</span>
                 </div>
              ))}
              {/* Show empty slots */}
              {Array.from({ length: 4 - gameState.players.length }).map((_, idx) => (
                 <div key={idx} style={{ padding: '12px 20px', backgroundColor: '#2c3e50', borderRadius: '8px', color: '#7f8c8d', fontStyle: 'italic' }}>
                    ... 빈 자리 ...
                 </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', marginTop: '30px' }}>
              <button 
                onClick={toggleReady}
                style={{ flex: 1, padding: '15px 0', backgroundColor: me.isReady ? '#e74c3c' : '#2ecc71', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold' }}
              >
                {me.isReady ? '레디 취소' : '레디'}
              </button>
              <button
                 onClick={leaveRoom}
                 style={{ flex: 1, padding: '15px 0', backgroundColor: '#95a5a6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold' }}
              >
                 나가기
              </button>
            </div>
          </div>
        )}

        {gameState.phase === 'GRAND_TICHU' && (
          <div className="passing-ui game-overlay">
            {me.tichuState === 'GRAND' ? (
              <p>👑 라지 티츄를 선언했습니다! 다른 플레이어를 기다리는 중...</p>
            ) : me.tichuState !== null ? (
              <p>다른 플레이어의 대답을 기다리는 중입니다... (현재 {me.hand.length}장)</p>
            ) : (
              <>
                <h3>라지 티츄를 선언하시겠습니까? (현재 8장)</h3>
                <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', marginTop: '20px' }}>
                  <button onClick={() => answerGrandTichu(true)} style={{ backgroundColor: '#e74c3c' }}>라지 티츄 (+200)</button>
                  <button onClick={() => answerGrandTichu(false)} style={{ backgroundColor: '#2ecc71' }}>패스</button>
                </div>
              </>
            )}
          </div>
        )}

        {gameState.phase === 'PASSING' && (
          <div className="passing-ui game-overlay">
            {hasAlreadyPassed ? (
              <p>다른 플레이어를 기다리는 중입니다...</p>
            ) : (
              <>
                <h3>{pendingPassCard ? '줄 상대를 선택하세요' : '선물할 카드를 선택하세요'}</h3>
                <div className="passing-targets">
                  {sortedOthers.map((p: any) => {
                    const alreadyAssigned = !!passingTargets[p.id];
                    return (
                      <div 
                        key={p.id} 
                        className={`target-slot ${alreadyAssigned ? 'filled' : ''} ${pendingPassCard && !alreadyAssigned ? 'active' : ''}`}
                        onClick={() => {
                          if (!pendingPassCard || alreadyAssigned) return;
                          // 카드가 이미 다른 사람에게 배정됐으면 해제
                          const prevAssignee = Object.keys(passingTargets).find(key => passingTargets[key] === pendingPassCard);
                          const newTargets = { ...passingTargets };
                          if (prevAssignee) delete newTargets[prevAssignee];
                          newTargets[p.id] = pendingPassCard;
                          setPassingTargets(newTargets);
                          setPendingPassCard(null);
                        }}
                      >
                        <div className="target-name">{getTargetName(p.id)}</div>
                        <div className="target-nick">{p.nickname}</div>
                        {alreadyAssigned && <div className="check-mark">✓</div>}
                      </div>
                    );
                  })}
                </div>
                
                <button 
                  disabled={Object.keys(passingTargets).length !== 3} 
                  onClick={handlePass}
                  className="pass-btn"
                >
                  카드 보내기 (3장)
                </button>
              </>
            )}
          </div>
        )}

        {(gameState.phase === 'PLAYING' || gameState.phase === 'FINISHED') && (
          <div className="playing-ui" style={{ textAlign: 'center', color: 'white', position: 'relative', width: '100%', height: '100%' }}>
            {showReceived && gameState.receivedPasses?.[me.id] ? (
              <div className="received-cards-overlay game-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'rgba(26, 37, 47, 0.95)', padding: '30px', borderRadius: '15px', zIndex: 1000, boxShadow: '0 10px 30px rgba(0,0,0,0.8)', border: '2px solid #2ecc71', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '90%', maxWidth: '400px' }}>
                <h3 style={{ color: '#2ecc71', marginBottom: '20px' }}>선물 교환 완료! (받은 카드)</h3>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '30px', width: '100%' }}>
                  {Object.entries(gameState.receivedPasses[me.id]).map(([fromId, card]: [string, any]) => {
                    const sender = gameState.players.find((p: any) => p.id === fromId);
                    return (
                      <div key={card.id} className="overlay-card-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '28%' }}>
                        <div style={{ marginBottom: '10px', fontSize: '0.95rem', fontWeight: 'bold', color: sender?.team === me.team ? '#5aa0e8' : '#e74c3c' }}>
                          {sender?.nickname}
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
              <div className="dog-event-overlay game-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', animation: 'fadeIn 0.3s ease-out', zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.85)', padding: '40px', borderRadius: '20px', border: '2px solid #e67e22' }}>
                <h2 style={{ fontSize: '3rem', marginBottom: '10px' }}>🐶 왈왈!</h2>
                <h3 style={{ color: '#e67e22', fontSize: '1.5rem' }}>개가 플레이되었습니다!</h3>
                <p style={{ marginTop: '20px', fontSize: '1.2rem' }}>
                  턴이 <strong>{gameState.players.find((p: any) => p.seat === activeEvent.targetSeat)?.nickname}</strong> 님에게 넘어갑니다!
                </p>
              </div>
            ) : gameState.cardEvent?.type === 'DragonGiveaway' && gameState.currentTurn === me.seat ? (
              <div className="dragon-event-overlay game-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', backgroundColor: 'rgba(26, 37, 47, 0.95)', padding: '30px', borderRadius: '15px', zIndex: 1000, border: '2px solid #e74c3c', boxShadow: '0 10px 30px rgba(0,0,0,0.8)', width: '90%', maxWidth: '400px' }}>
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
              <div className="dragon-event-overlay game-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', backgroundColor: 'rgba(26, 37, 47, 0.95)', padding: '30px', borderRadius: '15px', zIndex: 1000, border: '2px solid #3498db', boxShadow: '0 10px 30px rgba(0,0,0,0.8)' }}>
                <h2 style={{ color: '#3498db', fontSize: '1.5rem', marginBottom: '10px' }}>🎁 용의 선물!</h2>
                <p style={{ color: 'white', fontSize: '1.2rem', margin: 0 }}>
                  <strong>{gameState.players.find((p: any) => p.seat === activeEvent.fromSeat)?.nickname}</strong> 님이 <strong>{gameState.players.find((p: any) => p.seat === activeEvent.targetSeat)?.nickname}</strong> 님에게 트릭 더미를 넘겨주었습니다!
                </p>
              </div>
            ) : showWishPrompt ? (
              <div className="wish-prompt-overlay game-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', backgroundColor: 'rgba(26, 37, 47, 0.95)', padding: '30px', borderRadius: '15px', zIndex: 1000, border: '2px solid #f1c40f', boxShadow: '0 10px 30px rgba(0,0,0,0.8)', width: '90%', maxWidth: '400px' }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'center' }}>
                  {/* 소원 표시 */}
                  {gameState.currentWish && (
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                      <span style={{ color: '#f1c40f' }}>🐦 현재 소원: {
                        gameState.currentWish === 11 ? 'J' : gameState.currentWish === 12 ? 'Q' : gameState.currentWish === 13 ? 'K' : gameState.currentWish === 14 ? 'A' : gameState.currentWish
                      }</span>
                    </div>
                  )}
                
                {/* 본인 턴일 경우 중앙 더미 덱 위치 위에 배지 표시 */}
                {gameState.currentTurn === me.seat && (
                  <div style={{ 
                    backgroundColor: '#27ae60', color: 'white', padding: '6px 20px', 
                    borderRadius: '20px', fontSize: '1.1rem', fontWeight: 'bold',
                    marginBottom: '10px'
                  }}>
                    현재 차례 <span style={{ color: timeLeft <= 5 ? '#e74c3c' : '#f1c40f' }}>({timeLeft}s)</span>
                  </div>
                )}

                {/* 트릭(현재 깔린 패) 표시 영역 */}
                <div className="current-trick" style={{ minHeight: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {delayedLastTrick ? (
                    <>
                      <div style={{ marginBottom: '10px', color: '#f1c40f' }}>
                        {gameState.players.find((p: any) => p.id === delayedLastTrick?.playerId)?.nickname}의 {delayedLastTrick.type}
                      </div>
                      <div style={{ display: 'flex', gap: '5px', justifyContent: 'center', width: '100%', flexWrap: 'wrap' }}>
                        {delayedLastTrick.cards.map((card: any) => (
                          <CardComponent suit={card.suit} value={card.value} id={card.id} isSelected={false} disableHover={true} onClick={() => {}} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ paddingTop: '40px', textAlign: 'center' }}>
                      {gameState.currentTurn === me.seat ? (
                        <span style={{ color: '#f1c40f', fontWeight: 'bold', fontSize: '1.4rem' }}>원하는 카드를 내주세요</span>
                      ) : (
                        <span style={{ color: '#aaa', fontStyle: 'italic' }}>시작 플레이를 기다리는 중...</span>
                      )}
                    </div>
                  )}
                </div>



                {/* 내 턴이거나 폭탄을 들고 있을 때 컨트롤 표시 (게임 중일 때만) */}
                {gameState.phase === 'PLAYING' && (gameState.currentTurn === me.seat || (selectedPlayCards.length >= 4 && isBomb(selectedPlayCards))) && (
                  <div className="play-controls" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', zIndex: 10, position: 'relative', width: '100%' }}>
                    
                    {/* 선택된 조합 표시 */}
                    {selectedPlayCards.length > 0 && (
                      <div style={{ fontSize: '1.3rem', color: '#f1c40f', fontWeight: 'bold' }}>
                        {(() => {
                           const selectedCardsData = sortedHand.filter((c: any) => selectedPlayCards.includes(c.id));
                           const combo = HandValidator.validate(selectedCardsData);
                           
                           if (!combo || combo.type === 'Invalid') return '낼수 없는 조합';
                           
                           const valueMap: Record<number, string> = {
                             2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
                             11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '용', 16: '봉황', 1: '참새', 0: '개'
                           };
                           const valStr = valueMap[combo.value] || combo.value;
                           
                           switch(combo.type) {
                             case 'Single': return `${valStr} 싱글`;
                             case 'Pair': return `${valStr} 페어`;
                             case 'ConsecutivePairs': return `${valStr} 연속 페어 (${combo.length}장)`;
                             case 'Triple': return `${valStr} 트리플`;
                             case 'FullHouse': return `${valStr} 풀하우스`;
                             case 'Straight': return `${valStr} 스트레이트 (${combo.length}장)`;
                             case 'BombQuartet': return `${valStr} 포카드 (폭탄)`;
                             case 'BombStraightFlush': return `${valStr} 스티플 (폭탄)`;
                             case 'Dog': return '개 (턴 넘기기)';
                             default: return combo.type;
                           }
                        })()}
                      </div>
                    )}

                    {/* 에러 메시지 표시 */}
                    {playError && (
                      <div style={{ color: '#e74c3c', fontWeight: 'bold', fontSize: '1.05rem', backgroundColor: 'rgba(231, 76, 60, 0.1)', padding: '10px 15px', borderRadius: '8px', border: '1px solid #e74c3c', width: '100%', maxWidth: '400px', textAlign: 'center', whiteSpace: 'pre-line' }}>
                        ⚠️ {playError}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', width: '100%' }}>
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
                    {gameState.currentTurn === me.seat && gameState.currentTrickCards.length > 0 && (
                      <button 
                        className="pass-btn"
                        style={{ padding: '10px 20px', backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '5px', fontSize: '1.1rem', cursor: 'pointer' }}
                        onClick={handlePassTrick}
                      >
                        패스
                      </button>
                    )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="my-area">
        <div className="my-status" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: '20px', paddingLeft: '10px', gap: '10px', width: '100%' }}>
          {me.tichuState === 'GRAND' && <div className="grand-badge-self" style={{ marginTop: '0px' }}>👑 라지 티츄</div>}
          {me.tichuState === 'SMALL' && <div className="grand-badge-self" style={{ marginTop: '0px', backgroundColor: '#e67e22', color: '#fff' }}>🔥 스몰 티츄</div>}
          {gameState.phase === 'PLAYING' && me.hand.length === 14 && me.tichuState !== 'GRAND' && me.tichuState !== 'SMALL' && (
            <button 
              className="tichu-btn"
              style={{ padding: '6px 12px', backgroundColor: '#f1c40f', color: '#c0392b', border: 'none', borderRadius: '6px', fontSize: '0.9rem', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 2px 5px rgba(241,196,15,0.4)' }}
              onClick={callSmallTichu}
            >
              스몰 티츄 (+100)
            </button>
          )}
        </div>
        <div className="my-hand">
          {sortedHand.map((card: any) => {
            const isAssigned = gameState.phase === 'PASSING' ? Object.values(passingTargets).includes(card.id) : selectedPlayCards.includes(card.id);
            const assigneeId = gameState.phase === 'PASSING' ? Object.keys(passingTargets).find(key => passingTargets[key] === card.id) : null;
            
            return (
              <div key={card.id} className="card-wrapper" style={{ 
                  borderRadius: '8px'
                }}>
                {isAssigned && assigneeId && (
                  <div className="card-badge">{getTargetName(assigneeId)}</div>
                )}
                <CardComponent 
                  suit={card.suit}
                  value={card.value}
                  id={card.id}
                  isSelected={false}
                  onClick={() => handleCardClick(card.id)}
                  disableHover={isAssigned}
                  highlightColor={pendingPassCard === card.id ? '#3498db' : isAssigned ? '#f1c40f' : undefined}
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
