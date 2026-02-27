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
        // Or just apply them immediately but emit again.
        setTimeout(() => {
          const botIds = [`bot1_${roomId}`, `bot2_${roomId}`, `bot3_${roomId}`];
          botIds.forEach(botId => {
            engine.answerGrandTichu(botId, false);
          });
          io.to(roomId).emit('gameStateUpdate', engine.state);
        }, 500);
      });

      socket.on('answerGrandTichu', ({ roomId, callGrand }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.answerGrandTichu(socket.id, callGrand)) {
          // If we just entered PASSING phase, auto-pass for bots in Solo Test
          if (engine.state.phase === 'PASSING') {
            const botIds = [`bot1_${roomId}`, `bot2_${roomId}`, `bot3_${roomId}`];
            botIds.forEach(botId => {
              const botPlayer = engine.state.players.find(p => p.id === botId);
              if (botPlayer && botPlayer.hand.length >= 3) {
                const targets = engine.state.players.filter(p => p.id !== botId);
                engine.passCards(botId, {
                  [targets[0].id]: botPlayer.hand[0].id,
                  [targets[1].id]: botPlayer.hand[1].id,
                  [targets[2].id]: botPlayer.hand[2].id,
                });
              }
            });
          }
          io.to(roomId).emit('gameStateUpdate', engine.state);
        }
      });

      socket.on('passCards', ({ roomId, targetMap }) => {
        const engine = roomManager.getRoom(roomId);
        if (!engine) return;

        if (engine.passCards(socket.id, targetMap)) {
          io.to(roomId).emit('gameStateUpdate', engine.state);
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
