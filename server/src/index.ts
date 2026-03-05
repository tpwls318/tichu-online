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
    const address = await fastify.listen({ port: 3001, host: '0.0.0.0' });
    const io = new Server(fastify.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    console.log(`Server listening at ${address}`);

    io.on('connection', (socket) => {
      console.log('a user connected:', socket.id);

      socket.on('createRoom', ({ nickname }) => {
        const roomId = roomManager.createRoom();
        const engine = roomManager.getRoom(roomId)!;
        engine.addPlayer(socket.id, nickname);
        
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, gameState: engine.state });
        console.log(`Room ${roomId} created by ${nickname}`);
      });

      socket.on('joinRoom', ({ roomId, nickname }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) {
          socket.emit('error', '방을 찾을 수 없습니다.');
          return;
        }

        if (engine.addPlayer(socket.id, nickname)) {
          socket.join(roomId);
          console.log(`${nickname} joined room ${roomId}`);
          
          if (engine.state.players.length === 4 && engine.state.phase === 'WAITING') {
            engine.startGame();
            console.log(`Game started in room ${roomId}`);
          }
          
          io.to(roomId).emit('gameStateUpdate', engine.state);
        } else {
          socket.emit('error', '방이 가득 찼습니다.');
        }
      });

      socket.on('startSoloTest', ({ nickname }) => {
        // Create a room
        const roomId = roomManager.createRoom();
        const engine = roomManager.getRoom(roomId)!;
        
        // Add real player
        engine.addPlayer(socket.id, nickname);
        socket.join(roomId);
        
        // Add 3 fake bot players
        engine.addPlayer(`bot1_${roomId}`, 'Bot_West');
        engine.addPlayer(`bot2_${roomId}`, 'Bot_North(Partner)');
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
                // Sort hand by value (ascending)
                // Note: Dog=0, Sparrow=1, Dragon=15, Phoenix=16
                // For simplicity, we give the absolute lowest 2 cards to enemies, and the absolute highest to partner.
                // A better AI would keep Dog/Sparrow, but a simple value sort satisfies the immediate request.
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

          // 1. Wish Compliance
          if (wish !== null) {
            const wishCards = hand.filter(c => c.value === wish);
            if (wishCards.length > 0) {
              if (!lastTrick) {
                // Lead with the wish card
                tryPlay([wishCards[0].id]);
              } else if (lastTrick.type === 'Single' && wish > lastTrick.value) {
                tryPlay([wishCards[0].id]);
              } else if (lastTrick.type === 'Pair' && wishCards.length >= 2 && wish > lastTrick.value) {
                tryPlay([wishCards[0].id, wishCards[1].id]);
              } else if (lastTrick.type === 'Triple' && wishCards.length >= 3 && wish > lastTrick.value) {
                tryPlay([wishCards[0].id, wishCards[1].id, wishCards[2].id]);
              } else if (wishCards.length === 4) {
                // Play bomb if possible to satisfy wish
                tryPlay([wishCards[0].id, wishCards[1].id, wishCards[2].id, wishCards[3].id]);
              }

              // Fallback: If they STILL haven't played but HAVE the wish card, 
              // the engine will BLOCK their pass. So they MUST play it as a single (or whatever)
              // even if it's strictly an illegal pattern, they have no other choice to break the loop for simple AI.
              if (!played) {
                 tryPlay([wishCards[0].id]);
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
                // Play sparrow and make a random wish between 2 and 14
                const randomWish = Math.floor(Math.random() * 13) + 2; 
                tryPlay([sparrow.id], randomWish);
              } else {
                const lowest = hand.find(c => c.value > 1) || hand[0]; // avoid playing bomb pieces if possible, just naive
                if (lowest) tryPlay([lowest.id]);
              }
            } else {
              // Try to beat the trick, but don't step on partner's high cards
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
        }
      });

      socket.on('passTrick', ({ roomId }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.passTrick(socket.id)) {
          io.to(roomId).emit('gameStateUpdate', engine.state);
          checkAndTriggerBotPlay(engine, roomId);
        }
      });

      socket.on('giveDragonTrick', ({ roomId, targetId }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.giveDragonTrick(socket.id, targetId)) {
          io.to(roomId).emit('gameStateUpdate', engine.state);
          checkAndTriggerBotPlay(engine, roomId);
        }
      });

      socket.on('disconnect', () => {
        console.log('user disconnected');
        // TODO: Handle reconnection/player leaving
      });
    });

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
