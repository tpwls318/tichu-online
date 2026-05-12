import Fastify from 'fastify';
import { Server } from 'socket.io';
import cors from '@fastify/cors';

import { RoomManager } from './engine/roomManager.js';

const fastify = Fastify({
  logger: true
});

const roomManager = new RoomManager();

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
            }
          }
        };
        engine.onGameEnd = () => {
          console.log(`Game ended due to forfeit in room ${roomId}`);
          io.to(roomId).emit('gameStateUpdate', engine.state);
          
          // Clear all turn timers and disconnect timers
          engine.clearTurnTimer();
          for (const timer of Object.values(engine.disconnectTimers)) {
            clearTimeout(timer);
          }
        };
      };

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
          
          io.to(roomId).emit('gameStateUpdate', engine.state);
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

      // 라운드 종료 후 5초 뒤 자동으로 다음 라운드 시작
      const checkAndTriggerNewRound = (engine: ReturnType<RoomManager['getRoom']>, roomId: string) => {
        if (!engine || engine.state.phase !== 'FINISHED') return;

        setTimeout(() => {
          if (!engine || engine.state.phase !== 'FINISHED') return;
          
          const targetScore = engine.state.settings?.targetScore || 1000;
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
              
              if (dog) {
                tryPlay([dog.id]);
              } else if (sparrow) {
                const randomWish = Math.floor(Math.random() * 13) + 2; 
                tryPlay([sparrow.id], randomWish);
              } else {
                const lowest = hand.find(c => c.value > 1) || hand[0];
                if (lowest) tryPlay([lowest.id]);
              }
            } else {
              // Try to beat the trick
              const partner = engine.state.players.find(p => p.team === currentPlayer.team && p.id !== currentPlayer.id);
              const isPartnerWinningWithHighCard = partner && lastTrick.playerId === partner.id && lastTrick.value >= 10;
              
              if (!isPartnerWinningWithHighCard) {
                if (lastTrick.type === 'Single') {
                  const higherSingle = hand.find(c => c.value > lastTrick.value);
                  if (higherSingle) tryPlay([higherSingle.id]);
                } else if (lastTrick.type === 'Pair') {
                  for (let i = 0; i < hand.length - 1; i++) {
                    if (hand[i].value === hand[i+1].value && hand[i].value > lastTrick.value) {
                      tryPlay([hand[i].id, hand[i+1].id]);
                      break;
                    }
                  }
                }
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
            // Bot room: delete entirely when human disconnects
            const isBotRoom = engine.state.players.some(p => p.id.startsWith('bot'));
            if (isBotRoom) {
              engine.clearTurnTimer();
              for (const timer of Object.values(engine.disconnectTimers)) {
                clearTimeout(timer);
              }
              roomManager.removeRoom(roomId);
              console.log(`Bot room ${roomId} removed because human player disconnected.`);
            } else {
              const remaining = engine.removePlayer(socket.id);
              if (remaining === 0) {
                roomManager.removeRoom(roomId);
                console.log(`Room ${roomId} removed as it is empty after disconnect.`);
              } else {
                io.to(roomId).emit('gameStateUpdate', engine.state);
                console.log(`Player ${socket.id} disconnected from room ${roomId}.`);
              }
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
