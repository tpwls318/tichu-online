import { GameState, Player, Card, GamePhase } from '../types/game.js';
import { TichuDeck } from './deck.js';
import { HandValidator, Combination } from './validator.js';

export class TichuEngine {
  state: GameState;
  deck: TichuDeck;
  private remainingHands: { [playerId: string]: Card[] } = {};
  private grandTichuResponses: { [playerId: string]: boolean } = {};

  constructor(roomId: string) {
    this.deck = new TichuDeck();
    this.state = {
      roomId,
      players: [],
      phase: 'WAITING',
      currentTurn: 0,
      lastTrick: null,
      scores: { teamA: 0, teamB: 0 },
      passStates: {},
      history: []
    };
  }

  addPlayer(id: string, nickname: string) {
    if (this.state.players.length >= 4) return false;
    
    const team = this.state.players.length % 2 === 0 ? 'A' : 'B';
    const player: Player = {
      id,
      nickname,
      hand: [],
      tichuState: null,
      isReady: false,
      team,
      seat: this.state.players.length
    };
    
    this.state.players.push(player);
    return true;
  }

  startGame() {
    if (this.state.players.length < 4) return false;
    
    this.deck.reset();
    this.deck.shuffle();
    const { hands8, hands6 } = this.deck.deal();
    
    this.state.players.forEach((player, i) => {
      player.hand = hands8[i] || [];
      player.tichuState = null;
      this.remainingHands[player.id] = hands6[i] || [];
      this.state.passStates[player.id] = {};
    });
    
    this.state.phase = 'GRAND_TICHU';
    this.grandTichuResponses = {};
    return true;
  }

  answerGrandTichu(playerId: string, callGrand: boolean) {
    if (this.state.phase !== 'GRAND_TICHU') return false;
    
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;

    player.tichuState = callGrand ? 'GRAND' : 'NONE';
    this.grandTichuResponses[playerId] = true;

    // Deal remaining 6 cards immediately to this player
    player.hand.push(...(this.remainingHands[playerId] || []));
    delete this.remainingHands[playerId]; // clear to avoid duplicates if called again accidentally

    // Check if all 4 answered
    if (Object.keys(this.grandTichuResponses).length === 4) {
      // Move to PASSING
      this.state.phase = 'PASSING';
    }
    
    return true;
  }

  passCards(playerId: string, targetMap: { [targetId: string]: string }) {
    if (this.state.phase !== 'PASSING') return false;
    
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;

    for (const [targetId, cardId] of Object.entries(targetMap)) {
      const cardIndex = player.hand.findIndex(c => c.id === cardId);
      if (cardIndex === -1) continue;
      
      const card = player.hand[cardIndex]!;
      this.state.passStates[playerId]![targetId] = card;
    }

    // Check if all players have passed 3 cards
    const allPassed = this.state.players.every(p => 
      Object.keys(this.state.passStates[p.id] || {}).length === 3
    );

    if (allPassed) {
      this.completePassing();
    }
    
    return true;
  }

  private completePassing() {
    this.state.players.forEach(player => {
      // 1. Remove cards passed FROM this player
      const passedFromSelf = Object.values(this.state.passStates[player.id] || {});
      player.hand = player.hand.filter(c => !passedFromSelf.find(pc => pc.id === c.id));

      // 2. Add cards passed TO this player
      this.state.players.forEach(other => {
        const cardToSelf = this.state.passStates[other.id]?.[player.id];
        if (cardToSelf) {
          player.hand.push(cardToSelf);
        }
      });
    });

    this.state.phase = 'PLAYING';
    this.state.passStates = {};
    
    // Find player with sparrow to start
    const sparrowPlayer = this.state.players.find(p => p.hand.find(c => c.id === 'Sparrow'));
    if (sparrowPlayer) {
      this.state.currentTurn = sparrowPlayer.seat;
    }
  }
}
