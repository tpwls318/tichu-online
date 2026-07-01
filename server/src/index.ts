import Fastify from 'fastify';
import { Server } from 'socket.io';
import cors from '@fastify/cors';

import { RoomManager } from './engine/roomManager.js';
import { HandValidator } from './engine/validator.js';
import { userStore } from './utils/userStore.js';

const fastify = Fastify({
  logger: true
});

const roomManager = new RoomManager();

const recordGameResults = (engine: any, winningTeam: 'A' | 'B') => {
  if (!engine || engine.resultsRecorded) return;
  engine.resultsRecorded = true;

  engine.state.players.forEach((p: any) => {
    if (p.id.startsWith('bot') || !p.userId) return;
    if (p.team === winningTeam) {
      userStore.addWin(p.userId);
      console.log(`Recorded Win for user: ${p.userId}`);
    } else {
      userStore.addLoss(p.userId);
      console.log(`Recorded Loss for user: ${p.userId}`);
    }
  });
};

fastify.register(cors, {
  origin: '*'
});

fastify.get('/ping', async (request, reply) => {
  return { pong: 'it works!' };
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    const address = await fastify.listen({ port, host: '0.0.0.0' });
    const io = new Server(fastify.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    console.log(`Server listening at ${address}`);

    io.on('connection', (socket) => {
      console.log('a user connected:', socket.id);

      const setupEngineEvents = (roomId: string, engine: ReturnType<RoomManager['getRoom']>) => {
        if (!engine || engine.onTimerExpire) return;
        engine.onTimerExpire = () => {
          if (engine.state.phase === 'PLAYING') {
            const currentPlayer = engine.state.players.find(p => p.seat === engine.state.currentTurn);
            if (currentPlayer) {
              console.log(`Auto-passing for player ${currentPlayer.nickname} (${currentPlayer.id}) in room ${roomId}`);
              engine.passTrick(currentPlayer.id);
              io.to(roomId).emit('gameStateUpdate', engine.state);
              checkAndTriggerBotPlay(engine, roomId);
              checkAndTriggerNewRound(engine, roomId);
            }
          }
        };
        engine.onGameEnd = () => {
          console.log(`Game ended due to forfeit in room ${roomId}`);
          io.to(roomId).emit('gameStateUpdate', engine.state);

          // Forfeit: Find disconnected player and record win/loss
          const disconnectedPlayer = engine.state.players.find(p => p.isDisconnected);
          if (disconnectedPlayer) {
            const losingTeam = disconnectedPlayer.team;
            const winningTeam = losingTeam === 'A' ? 'B' : 'A';
            recordGameResults(engine, winningTeam);
          }
          
          // Clear all turn timers and disconnect timers
          engine.clearTurnTimer();
          for (const timer of Object.values(engine.disconnectTimers)) {
            clearTimeout(timer);
          }
          
          // If it's a bot room, destroy it completely on forfeit so returning players don't join a dead game
          const isBotRoom = engine.state.players.some(p => p.id.startsWith('bot'));
          if (isBotRoom) {
            roomManager.removeRoom(roomId);
            console.log(`Bot room ${roomId} completely destroyed after forfeit timeout.`);
          }
        };
      };

      // User authentication handlers
      socket.on('register', ({ username, password, nickname }) => {
        const result = userStore.registerUser(username, password, nickname);
        if (result.success) {
          // Auto-login upon successful registration
          const authResult = userStore.authenticateUser(username, password);
          if (authResult.success && authResult.user) {
            socket.emit('loginSuccess', { 
              userId: authResult.user.username, 
              nickname: authResult.user.nickname,
              wins: authResult.user.wins,
              losses: authResult.user.losses,
              message: '회원가입 및 로그인이 완료되었습니다.' 
            });
          } else {
            socket.emit('registerSuccess', { message: result.message });
          }
        } else {
          socket.emit('registerFailed', { message: result.message });
        }
      });

      socket.on('login', ({ username, password }) => {
        const result = userStore.authenticateUser(username, password);
        if (result.success && result.user) {
          socket.emit('loginSuccess', { 
            userId: result.user.username, 
            nickname: result.user.nickname,
            wins: result.user.wins,
            losses: result.user.losses,
            message: result.message 
          });
        } else {
          socket.emit('loginFailed', { message: result.message });
        }
      });

      socket.on('getUserStats', ({ userId }) => {
        if (!userId) return;
        const stats = userStore.getUserStats(userId);
        if (stats) {
          socket.emit('userStatsUpdate', {
            userId,
            wins: stats.wins,
            losses: stats.losses
          });
        }
      });

      socket.on('createRoom', ({ nickname, settings, userId }) => {
        const roomName = `${nickname}의 방`;
        const roomId = roomManager.createRoom(roomName, settings);
        const engine = roomManager.getRoom(roomId)!;
        setupEngineEvents(roomId, engine);
        engine.addPlayer(socket.id, nickname, userId);
        
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, gameState: engine.state });
        console.log(`Room ${roomId} created by ${nickname}`);
      });

      socket.on('joinRoom', ({ roomId, nickname, userId }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) {
          socket.emit('error', '방을 찾을 수 없습니다.');
          return;
        }

        setupEngineEvents(roomId, engine);

        if (engine.addPlayer(socket.id, nickname, userId)) {
          socket.join(roomId);
          console.log(`${nickname} joined room ${roomId}`);
          
          // Direct emit to ensure the reconnecting client definitely gets the update immediately
          socket.emit('gameStateUpdate', engine.state);
          io.to(roomId).emit('gameStateUpdate', engine.state);
          
          // After reconnection, if it's a bot's turn, trigger bot play
          checkAndTriggerBotPlay(engine, roomId);
          checkAndTriggerNewRound(engine, roomId);
        } else {
          socket.emit('error', '방이 가득 찼습니다.');
        }
      });

      socket.on('updateNickname', ({ roomId, newNickname }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.updateNickname(socket.id, newNickname)) {
          io.to(roomId).emit('gameStateUpdate', engine.state);
        }
      });

      socket.on('getRooms', () => {
        const rooms = roomManager.getAllRooms().map(([id, engine]) => ({
          roomId: id,
          roomName: engine.state.roomName,
          playerCount: engine.state.players.length,
          activePlayerCount: engine.state.players.filter(p => !p.isDisconnected).length,
          disconnectedUserIds: engine.state.players.filter(p => p.isDisconnected).map(p => p.userId),
          phase: engine.state.phase,
          targetScore: engine.state.settings?.targetScore,
        }));
        socket.emit('roomListUpdate', rooms);
      });

      socket.on('startSoloTest', ({ nickname, settings, userId }) => {
        // Create a room
        const roomName = `${nickname}의 봇방`;
        const roomId = roomManager.createRoom(roomName, settings);
        const engine = roomManager.getRoom(roomId)!;
        setupEngineEvents(roomId, engine);
        
        // Add real player
        engine.addPlayer(socket.id, nickname, userId);
        socket.join(roomId);
        
        // Add 3 fake bot players
        engine.addPlayer(`bot1_${roomId}`, 'Bot_West');
        engine.addPlayer(`bot2_${roomId}`, 'Bot_North');
        engine.addPlayer(`bot3_${roomId}`, 'Bot_East');
        
        // Auto start
        engine.startGame();
        console.log(`Solo Test game started in room ${roomId} for ${nickname}`);
        
        // Let the client receive the initial 8 cards first
        io.to(roomId).emit('roomCreated', { roomId, gameState: engine.state });
        io.to(roomId).emit('gameStateUpdate', engine.state);
        
        // Then, slightly delay the bots' responses so the client can see the state change
        setTimeout(() => {
          const botIds = [`bot1_${roomId}`, `bot2_${roomId}`, `bot3_${roomId}`];
          botIds.forEach(botId => {
            engine.answerGrandTichu(botId, false);
          });
          
          checkAndTriggerBotPassing(engine, roomId);
          io.to(roomId).emit('gameStateUpdate', engine.state);
        }, 500);
      });

      const checkAndTriggerBotPassing = (engine: ReturnType<RoomManager['getRoom']>, roomId: string) => {
        if (!engine) return;
        if (engine.state.phase === 'PASSING') {
          const botIds = [`bot1_${roomId}`, `bot2_${roomId}`, `bot3_${roomId}`];
          botIds.forEach(botId => {
            const botPlayer = engine.state.players.find(p => p.id === botId);
            const hasPassed = Object.keys(engine.state.passStates[botId] || {}).length === 3;
            
            if (botPlayer && botPlayer.hand.length >= 3 && !hasPassed) {
              const partner = engine.state.players.find(p => p.team === botPlayer.team && p.id !== botId);
              const enemies = engine.state.players.filter(p => p.team !== botPlayer.team);
              
              if (partner && enemies.length === 2) {
                const sortedHand = [...botPlayer.hand].sort((a, b) => a.value - b.value);
                
                const lowest1 = sortedHand[0];
                const lowest2 = sortedHand[1];
                const highest = sortedHand[sortedHand.length - 1];

                engine.passCards(botId, {
                  [enemies[0].id]: lowest1.id,
                  [enemies[1].id]: lowest2.id,
                  [partner.id]: highest.id,
                });
              }
            }
          });
        }
      };

      const checkAndTriggerNewRound = (engine: ReturnType<RoomManager['getRoom']>, roomId: string) => {
        if (!engine || engine.state.phase !== 'FINISHED') return;

        const targetScore = engine.state.settings?.targetScore || 1000;
        if (engine.state.scores.teamA >= targetScore) {
          recordGameResults(engine, 'A');
        } else if (engine.state.scores.teamB >= targetScore) {
          recordGameResults(engine, 'B');
        }

        setTimeout(() => {
          if (!engine || engine.state.phase !== 'FINISHED') return;
          
          if (engine.state.scores.teamA >= targetScore) {
            engine.state.roundResult!.message = `🏆 A팀이 ${targetScore}점을 달성하여 최종 승리했습니다!`;
            io.to(roomId).emit('gameStateUpdate', engine.state);
            return;
          } else if (engine.state.scores.teamB >= targetScore) {
            engine.state.roundResult!.message = `🏆 B팀이 ${targetScore}점을 달성하여 최종 승리했습니다!`;
            io.to(roomId).emit('gameStateUpdate', engine.state);
            return;
          }

          engine.startNewRound();
          io.to(roomId).emit('gameStateUpdate', engine.state);
          console.log(`New round started in room ${roomId}`);

          // 솔로 모드 봇 처리
          const botIds = [`bot1_${roomId}`, `bot2_${roomId}`, `bot3_${roomId}`];
          const hasBot = engine.state.players.some(p => botIds.includes(p.id));
          if (hasBot) {
            setTimeout(() => {
              botIds.forEach(botId => {
                engine.answerGrandTichu(botId, false);
              });
              checkAndTriggerBotPassing(engine, roomId);
              io.to(roomId).emit('gameStateUpdate', engine.state);
            }, 500);
          }
        }, 5000); // 5초간 라운드 결과 표시 후 다음 라운드
      };

      const checkAndTriggerBotPlay = (engine: ReturnType<RoomManager['getRoom']>, roomId: string) => {
        if (!engine || engine.state.phase !== 'PLAYING') return;

        const currentPlayer = engine.state.players.find(p => p.seat === engine.state.currentTurn);
        if (!currentPlayer || !currentPlayer.id.startsWith('bot')) return;

        setTimeout(() => {
          // If the bot just won a Dragon trick, give it away and return
          if (engine.state.cardEvent?.type === 'DragonGiveaway' && engine.state.cardEvent.targetSeat === currentPlayer.seat) {
            const enemies = engine.state.players.filter(p => p.team !== currentPlayer.team);
            if (enemies.length > 0) {
              engine.giveDragonTrick(currentPlayer.id, enemies[0].id);
              io.to(roomId).emit('gameStateUpdate', engine.state);
              checkAndTriggerBotPlay(engine, roomId);
            }
            return;
          }

          // Double check if it's still their turn and phase is playing
          if (engine.state.phase !== 'PLAYING' || engine.state.currentTurn !== currentPlayer.seat) return;

          const hand = [...currentPlayer.hand].sort((a, b) => a.value - b.value);
          const lastTrick = engine.state.lastTrick;

          let played = false;
          const wish = engine.state.currentWish;

          // Helper to play a combo
          const tryPlay = (cardIds: string[], wishValue?: number) => {
            if (engine.playCards(currentPlayer.id, cardIds, wishValue)) {
              played = true;
            }
          };

          // 1. Wish Compliance - must play a valid combo containing the wish card
          if (wish !== null) {
            const wishCards = hand.filter(c => c.value === wish);
            const phoenix = hand.find(c => c.value === 16);
            // Build value->cards map for combo construction
            const valueCounts: Record<number, any[]> = {};
            for (const c of hand) {
              if (c.value >= 2 && c.value <= 14) {
                if (!valueCounts[c.value]) valueCounts[c.value] = [];
                valueCounts[c.value].push(c);
              }
            }

            if (wishCards.length > 0) {
              if (!lastTrick) {
                // Free lead
                tryPlay([wishCards[0].id]);

              } else if (lastTrick.type === 'Single' && wish > lastTrick.value) {
                tryPlay([wishCards[0].id]);

              } else if (lastTrick.type === 'Pair' && wish > lastTrick.value) {
                if (wishCards.length >= 2) {
                  tryPlay([wishCards[0].id, wishCards[1].id]);
                } else if (phoenix) {
                  tryPlay([wishCards[0].id, phoenix.id]);
                }

              } else if (lastTrick.type === 'Triple' && wish > lastTrick.value) {
                if (wishCards.length >= 3) {
                  tryPlay([wishCards[0].id, wishCards[1].id, wishCards[2].id]);
                } else if (wishCards.length >= 2 && phoenix) {
                  tryPlay([wishCards[0].id, wishCards[1].id, phoenix.id]);
                }

              } else if (lastTrick.type === 'FullHouse') {
                // Try wish as triple part
                if (wishCards.length >= 3 && wish > lastTrick.value) {
                  for (const [v, cards] of Object.entries(valueCounts)) {
                    if (played) break;
                    if (Number(v) === wish) continue;
                    if (cards.length >= 2) {
                      tryPlay([wishCards[0].id, wishCards[1].id, wishCards[2].id, cards[0].id, cards[1].id]);
                    } else if (cards.length === 1 && phoenix) {
                      tryPlay([wishCards[0].id, wishCards[1].id, wishCards[2].id, cards[0].id, phoenix.id]);
                    }
                  }
                }
                // Try wish as triple with phoenix help (2 wish + phoenix = triple)
                if (!played && wishCards.length >= 2 && phoenix && wish > lastTrick.value) {
                  for (const [v, cards] of Object.entries(valueCounts)) {
                    if (played) break;
                    if (Number(v) === wish) continue;
                    if (cards.length >= 2) {
                      tryPlay([wishCards[0].id, wishCards[1].id, phoenix.id, cards[0].id, cards[1].id]);
                    }
                  }
                }
                // Try wish as pair part, with a different triple
                if (!played && wishCards.length >= 2) {
                  for (const [v, cards] of Object.entries(valueCounts)) {
                    if (played) break;
                    if (Number(v) === wish) continue;
                    if (cards.length >= 3 && Number(v) > lastTrick.value) {
                      tryPlay([cards[0].id, cards[1].id, cards[2].id, wishCards[0].id, wishCards[1].id]);
                    }
                  }
                }
                // Try wish as pair with phoenix, with a different triple
                if (!played && wishCards.length >= 1 && phoenix) {
                  for (const [v, cards] of Object.entries(valueCounts)) {
                    if (played) break;
                    if (Number(v) === wish) continue;
                    if (cards.length >= 3 && Number(v) > lastTrick.value) {
                      tryPlay([cards[0].id, cards[1].id, cards[2].id, wishCards[0].id, phoenix.id]);
                    }
                  }
                }

              } else if (lastTrick.type === 'Straight') {
                const requiredLength = lastTrick.cards.length;
                const availableValues = new Map<number, any>();
                for (const c of hand) {
                  if (c.value >= 2 && c.value <= 14) {
                    if (!availableValues.has(c.value)) availableValues.set(c.value, c);
                  }
                }

                for (let start = 2; start <= 14 - requiredLength + 1 && !played; start++) {
                  const end = start + requiredLength - 1;
                  if (end <= lastTrick.value) continue;
                  if (wish < start || wish > end) continue;

                  const cards: any[] = [];
                  let missingCount = 0;
                  let valid = true;
                  for (let v = start; v <= end; v++) {
                    if (availableValues.has(v)) {
                      cards.push(availableValues.get(v));
                    } else {
                      missingCount++;
                      if (missingCount === 1 && phoenix) {
                        cards.push(phoenix);
                      } else {
                        valid = false;
                        break;
                      }
                    }
                  }

                  if (valid && cards.length === requiredLength) {
                    tryPlay(cards.map((c: any) => c.id));
                  }
                }

              } else if (lastTrick.type === 'ConsecutivePairs') {
                const requiredPairs = lastTrick.cards.length / 2;
                for (let start = 2; start <= 14 - requiredPairs + 1 && !played; start++) {
                  const end = start + requiredPairs - 1;
                  if (end <= lastTrick.value) continue;
                  if (wish < start || wish > end) continue;

                  const cards: any[] = [];
                  let phoenixUsed = false;
                  let valid = true;
                  for (let v = start; v <= end; v++) {
                    const available = valueCounts[v] || [];
                    if (available.length >= 2) {
                      cards.push(available[0], available[1]);
                    } else if (available.length === 1 && !phoenixUsed && phoenix) {
                      cards.push(available[0], phoenix);
                      phoenixUsed = true;
                    } else {
                      valid = false;
                      break;
                    }
                  }

                  if (valid && cards.length === requiredPairs * 2) {
                    tryPlay(cards.map((c: any) => c.id));
                  }
                }
              }

              // Bomb with wish cards (always possible regardless of lastTrick type)
              if (!played && wishCards.length === 4) {
                tryPlay([wishCards[0].id, wishCards[1].id, wishCards[2].id, wishCards[3].id]);
              }
            }
          }

          if (!played) {
            if (!lastTrick) {
              // Free lead
              const dog = hand.find(c => c.value === 0);
              const sparrow = hand.find(c => c.value === 1);

              // 50% probability to play a single card OR if there are no combinations
              const playSingle = Math.random() < 0.5;

              // Generate all combinations
              const cardsByValue: Record<number, any[]> = {};
              for (const card of hand) {
                if (!cardsByValue[card.value]) {
                  cardsByValue[card.value] = [];
                }
                cardsByValue[card.value].push(card);
              }

              const pairs: any[][] = [];
              const triples: any[][] = [];
              for (const [valueStr, cards] of Object.entries(cardsByValue)) {
                const val = Number(valueStr);
                if (val >= 2 && val <= 14) {
                  if (cards.length >= 2) pairs.push([cards[0], cards[1]]);
                  if (cards.length >= 3) triples.push([cards[0], cards[1], cards[2]]);
                }
              }

              const fullHouses: any[][] = [];
              for (const t of triples) {
                for (const p of pairs) {
                  if (t[0].value !== p[0].value) {
                    fullHouses.push([...t, ...p]);
                  }
                }
              }

              const uniqueValues = Array.from(new Set(hand.map(c => c.value)))
                .filter(v => v === 1 || (v >= 2 && v <= 14))
                .sort((a, b) => a - b);

              const straights: any[][] = [];
              for (let len = 5; len <= uniqueValues.length; len++) {
                for (let i = 0; i <= uniqueValues.length - len; i++) {
                  let isStraight = true;
                  for (let j = 1; j < len; j++) {
                    if (uniqueValues[i + j] !== uniqueValues[i + j - 1] + 1) {
                      isStraight = false;
                      break;
                    }
                  }
                  if (isStraight) {
                    const straightCards = uniqueValues.slice(i, i + len).map(val => cardsByValue[val][0]);
                    straights.push(straightCards);
                  }
                }
              }

              const cpPairs: any[][] = [];
              const pairValues = Object.keys(cardsByValue)
                .map(Number)
                .filter(val => val >= 2 && val <= 14 && cardsByValue[val].length >= 2)
                .sort((a, b) => a - b);

              const consecutivePairs: any[][] = [];
              for (let len = 2; len <= pairValues.length; len++) {
                for (let i = 0; i <= pairValues.length - len; i++) {
                  let isConsecutive = true;
                  for (let j = 1; j < len; j++) {
                    if (pairValues[i + j] !== pairValues[i + j - 1] + 1) {
                      isConsecutive = false;
                      break;
                    }
                  }
                  if (isConsecutive) {
                    const cpCards: any[] = [];
                    for (let j = 0; j < len; j++) {
                      const val = pairValues[i + j];
                      cpCards.push(cardsByValue[val][0], cardsByValue[val][1]);
                    }
                    consecutivePairs.push(cpCards);
                  }
                }
              }

              const allCombos = [
                ...pairs,
                ...triples,
                ...fullHouses,
                ...straights,
                ...consecutivePairs
              ];

              if (!playSingle && allCombos.length > 0) {
                // Play a random combination
                const chosenCombo = allCombos[Math.floor(Math.random() * allCombos.length)];
                tryPlay(chosenCombo.map(c => c.id));
              }

              // Fallback to playing a single card
              if (!played) {
                if (dog) {
                  tryPlay([dog.id]);
                } else if (sparrow) {
                  const randomWish = Math.floor(Math.random() * 13) + 2;
                  tryPlay([sparrow.id], randomWish);
                } else {
                  const lowest = hand.find(c => c.value > 1) || hand[0];
                  if (lowest) tryPlay([lowest.id]);
                }
              }
            } else {
              // Try to beat the trick
              const requiredLength = lastTrick.cards.length;
              const prevCombo = {
                type: lastTrick.type as any,
                value: lastTrick.value,
                length: lastTrick.cards.length,
                cards: lastTrick.cards
              };

              const getSubsets = (arr: any[], len: number): any[][] => {
                const res: any[][] = [];
                const fork = (idx: number, cur: any[]) => {
                  if (cur.length === len) {
                    res.push(cur);
                    return;
                  }
                  if (idx >= arr.length) return;
                  fork(idx + 1, [...cur, arr[idx]]);
                  fork(idx + 1, cur);
                };
                fork(0, []);
                return res;
              };

              const validPlays: any[][] = [];

              // 1. Check all subsets of matching length
              const subsets = getSubsets(hand, requiredLength);
              for (const subset of subsets) {
                const result = HandValidator.validate(subset);
                if (result.type !== 'Invalid' && HandValidator.compare(prevCombo, result)) {
                  validPlays.push(subset);
                }
              }

              // 2. Check for Quartets (Quartet Bomb)
              const cardsByValue: Record<number, any[]> = {};
              for (const card of hand) {
                if (!cardsByValue[card.value]) cardsByValue[card.value] = [];
                cardsByValue[card.value].push(card);
              }

              for (const [valStr, cards] of Object.entries(cardsByValue)) {
                if (cards.length === 4) {
                  const result = HandValidator.validate(cards);
                  if (result.type !== 'Invalid' && HandValidator.compare(prevCombo, result)) {
                    validPlays.push(cards);
                  }
                }
              }

              // 3. Check for Straight Flushes (Straight Flush Bomb)
              const suits = ['Jade', 'Sword', 'Pagoda', 'Star'];
              for (const suit of suits) {
                const suitCards = hand.filter(c => c.suit === suit);
                for (let len = 5; len <= Math.min(suitCards.length, 14); len++) {
                  const suitSubsets = getSubsets(suitCards, len);
                  for (const subset of suitSubsets) {
                    const result = HandValidator.validate(subset);
                    if (result.type === 'BombStraightFlush' && HandValidator.compare(prevCombo, result)) {
                      validPlays.push(subset);
                    }
                  }
                }
              }

              // Apply K/A 20% rule
              const allowedPlays = validPlays.filter(play => {
                const hasKOrA = play.some(c => c.value === 13 || c.value === 14);
                if (hasKOrA) {
                  return Math.random() < 0.2;
                }
                return true;
              });

              if (allowedPlays.length > 0) {
                const chosenPlay = allowedPlays[Math.floor(Math.random() * allowedPlays.length)];
                tryPlay(chosenPlay.map(c => c.id));
              }
            }
          }

          if (!played) {
            engine.passTrick(currentPlayer.id);
          }

          io.to(roomId).emit('gameStateUpdate', engine.state);
          
          // Recursively check next turn
          checkAndTriggerBotPlay(engine, roomId);
          // 라운드 종료 체크
          checkAndTriggerNewRound(engine, roomId);
        }, 1500); // 1.5 second bot think time
      };

      socket.on('answerGrandTichu', ({ roomId, callGrand }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.answerGrandTichu(socket.id, callGrand)) {
          checkAndTriggerBotPassing(engine, roomId);
          io.to(roomId).emit('gameStateUpdate', engine.state);
        }
      });

      socket.on('callSmallTichu', ({ roomId }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.callSmallTichu(socket.id)) {
          io.to(roomId).emit('gameStateUpdate', engine.state);
        }
      });

      socket.on('passCards', ({ roomId, targetMap }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.passCards(socket.id, targetMap)) {
          io.to(roomId).emit('gameStateUpdate', engine.state);
          checkAndTriggerBotPlay(engine, roomId);
        }
      });

      socket.on('playCards', ({ roomId, cardIds, wishValue }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.playCards(socket.id, cardIds, wishValue)) {
          io.to(roomId).emit('gameStateUpdate', engine.state);
          checkAndTriggerBotPlay(engine, roomId);
          checkAndTriggerNewRound(engine, roomId);
        }
      });

      socket.on('passTrick', ({ roomId }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.passTrick(socket.id)) {
          io.to(roomId).emit('gameStateUpdate', engine.state);
          checkAndTriggerBotPlay(engine, roomId);
          checkAndTriggerNewRound(engine, roomId);
        }
      });

      socket.on('giveDragonTrick', ({ roomId, targetId }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.giveDragonTrick(socket.id, targetId)) {
          io.to(roomId).emit('gameStateUpdate', engine.state);
          checkAndTriggerBotPlay(engine, roomId);
          checkAndTriggerNewRound(engine, roomId);
        }
      });

      socket.on('toggleReady', ({ roomId }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine || engine.state.phase !== 'WAITING') return;

        engine.toggleReady(socket.id);
        
        // Check if all 4 players are ready
        if (engine.state.players.length === 4 && engine.state.players.every(p => p.isReady)) {
          engine.startGame();
          console.log(`Game started dynamically in room ${roomId} as all players are ready`);
        }
        
        io.to(roomId).emit('gameStateUpdate', engine.state);
      });

      socket.on('returnToWaitingRoom', ({ roomId }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine || engine.state.phase !== 'FINISHED') return;

        engine.returnToWaitingRoom();
        io.to(roomId).emit('gameStateUpdate', engine.state);
      });

      socket.on('playAgain', ({ roomId }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine || engine.state.phase !== 'FINISHED') return;

        engine.returnToWaitingRoom();
        engine.startGame();
        
        io.to(roomId).emit('gameStateUpdate', engine.state);
        console.log(`Solo Test game restarted in room ${roomId}`);

        setTimeout(() => {
          const botIds = [`bot1_${roomId}`, `bot2_${roomId}`, `bot3_${roomId}`];
          botIds.forEach(botId => {
            engine.answerGrandTichu(botId, false);
          });
          
          checkAndTriggerBotPassing(engine, roomId);
          io.to(roomId).emit('gameStateUpdate', engine.state);
        }, 500);
      });

      socket.on('callSmallTichu', ({ roomId }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.callSmallTichu(socket.id)) {
          io.to(roomId).emit('gameStateUpdate', engine.state);
          console.log(`Player ${socket.id} called Tichu in room ${roomId}`);
        }
      });
      socket.on('leaveRoom', ({ roomId }) => {
        const engine = roomManager.getRoom(roomId);
        if (engine) {
          socket.leave(roomId);
          
          // Bot room: if the leaving player is the only human, delete the entire room
          const isBotRoom = engine.state.players.some(p => p.id.startsWith('bot'));
          if (isBotRoom) {
            engine.clearTurnTimer();
            for (const timer of Object.values(engine.disconnectTimers)) {
              clearTimeout(timer);
            }
            roomManager.removeRoom(roomId);
            console.log(`Bot room ${roomId} removed because human player left.`);
          } else {
            const remaining = engine.removePlayer(socket.id);
            if (remaining === 0) {
              roomManager.removeRoom(roomId);
              console.log(`Room ${roomId} removed as it is empty.`);
            } else {
              io.to(roomId).emit('gameStateUpdate', engine.state);
              console.log(`Player ${socket.id} left room ${roomId}`);
            }
          }
        }
      });

      socket.on('disconnect', () => {
        console.log(`user ${socket.id} disconnected`);
        const allRooms = roomManager.getAllRooms();
        for (const [roomId, engine] of allRooms) {
          const player = engine.state.players.find((p: any) => p.id === socket.id);
          if (player) {
            const remaining = engine.removePlayer(socket.id);
            if (remaining === 0) {
              roomManager.removeRoom(roomId);
              console.log(`Room ${roomId} removed as it is empty after disconnect.`);
            } else {
              io.to(roomId).emit('gameStateUpdate', engine.state);
              console.log(`Player ${socket.id} disconnected from room ${roomId}.`);
            }
            break;
          }
        }
      });
    });

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
